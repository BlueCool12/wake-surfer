import { createMessageSendModule } from "@wake-surfer/realtime-chat-message-send";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "../src/realtime-chat-integration-test";

describe("realtime-chat Atlas PostgreSQL migration", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("applies the schema and records every Atlas revision", async () => {
    const relations = await sql<{
      gatewayTickets: string | null;
      messageStreams: string | null;
      messages: string | null;
      revisions: string | null;
    }>`
      SELECT
        to_regclass('gateway_tickets')::text AS "gatewayTickets",
        to_regclass('message_streams')::text AS "messageStreams",
        to_regclass('messages')::text AS messages,
        to_regclass('atlas_schema_revisions')::text AS revisions
    `.execute(getDatabase().db);

    expect(relations.rows).toEqual([
      {
        gatewayTickets: "gateway_tickets",
        messageStreams: "message_streams",
        messages: "messages",
        revisions: "atlas_schema_revisions",
      },
    ]);

    const revisions = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM atlas_schema_revisions
    `.execute(getDatabase().db);
    expect(revisions.rows).toEqual([{ count: "2" }]);
  });

  it("stores the sender-scoped idempotency key without obsolete message fields", async () => {
    const columns = await sql<{ columnName: string }>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'messages'
      ORDER BY ordinal_position
    `.execute(getDatabase().db);

    expect(columns.rows.map((row) => row.columnName)).toEqual([
      "message_id",
      "stream_id",
      "sequence",
      "sender_actor_id",
      "target_type",
      "target_id",
      "idempotency_key",
      "content_text",
      "created_at",
    ]);
  });

  it("enforces the message UTF-8 8KiB constraint", async () => {
    await sql`
      INSERT INTO message_streams (stream_id, target_type, target_id, last_sequence, created_at)
      VALUES (${"channel:constraint-test"}, ${"channel"}, ${"constraint-test"}, 1, now())
    `.execute(getDatabase().db);

    await expect(
      insertMessage({
        messageId: "message-oversized-content",
        sequence: 1,
        contentText: "a".repeat(8193),
      }),
    ).rejects.toThrow("messages_content_text_utf8_8kib_check");
  });

  it("serializes concurrent reuse of one sender-scoped key and rejects a different payload", async () => {
    let nextMessageId = 0;
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({ status: "allowed" }),
      messageIdGenerator: {
        generate: () => `message-concurrent-${++nextMessageId}`,
      },
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });
    const shared = {
      senderActorId: "actor-concurrent",
      idempotencyKey: "idempotency-concurrent",
      text: "hello",
    } as const;
    const results = await Promise.all([
      messageSend.send({
        ...shared,
        target: { type: "channel", channelId: "concurrent-a" },
      }),
      messageSend.send({
        ...shared,
        target: { type: "channel", channelId: "concurrent-b" },
      }),
    ]);

    expect(results.filter((result) => result.status === "accepted")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      {
        status: "rejected",
        reason: "idempotency_conflict",
      },
    ]);

    const accepted = results.find((result) => result.status === "accepted");

    if (accepted?.status !== "accepted") {
      throw new Error("동시 전송 중 하나는 저장되어야 합니다.");
    }

    await expect(
      messageSend.send({
        ...shared,
        target: accepted.message.target,
        text: " hello ",
      }),
    ).resolves.toEqual(accepted);

    const rows = await getDatabase()
      .db.selectFrom("messages")
      .select(["message_id", "stream_id", "sequence"])
      .where("sender_actor_id", "=", shared.senderActorId)
      .where("idempotency_key", "=", shared.idempotencyKey)
      .execute();

    expect(rows).toEqual([
      {
        message_id: accepted.message.messageId,
        stream_id: accepted.message.streamId,
        sequence: 1,
      },
    ]);
  });

  it("allows different senders to reuse the same idempotency key", async () => {
    let nextMessageId = 0;
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({ status: "allowed" }),
      messageIdGenerator: {
        generate: () => `message-shared-key-${++nextMessageId}`,
      },
    });

    const results = await Promise.all([
      messageSend.send({
        senderActorId: "actor-shared-a",
        idempotencyKey: "shared-key",
        target: { type: "channel", channelId: "shared-key-channel" },
        text: "from a",
      }),
      messageSend.send({
        senderActorId: "actor-shared-b",
        idempotencyKey: "shared-key",
        target: { type: "channel", channelId: "shared-key-channel" },
        text: "from b",
      }),
    ]);

    expect(results.every((result) => result.status === "accepted")).toBe(true);
    expect(
      results
        .filter((result) => result.status === "accepted")
        .map((result) => result.message.sequence)
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
  });

  function getDatabase(): RealtimeChatIntegrationTestDatabase {
    if (database === undefined) {
      throw new Error("realtime-chat database 통합 테스트가 준비되지 않았습니다.");
    }

    return database;
  }

  async function insertMessage(input: {
    messageId: string;
    sequence: number;
    contentText: string;
  }): Promise<void> {
    await sql`
      INSERT INTO messages (
        message_id,
        stream_id,
        sequence,
        sender_actor_id,
        target_type,
        target_id,
        idempotency_key,
        content_text,
        created_at
      )
      VALUES (
        ${input.messageId},
        ${"channel:constraint-test"},
        ${input.sequence},
        ${"actor-constraint-test"},
        ${"channel"},
        ${"constraint-test"},
        ${`idempotency-${input.messageId}`},
        ${input.contentText},
        now()
      )
    `.execute(getDatabase().db);
  }
});
