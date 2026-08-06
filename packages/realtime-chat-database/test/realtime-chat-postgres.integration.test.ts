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

  it("applies the versioned schema and records every Atlas revision", async () => {
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

  it("migrates message correlation to sender-scoped idempotency keys", async () => {
    const columns = await sql<{ columnName: string }>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'messages'
        AND column_name IN ('client_message_id', 'idempotency_key')
      ORDER BY column_name
    `.execute(getDatabase().db);

    expect(columns.rows).toEqual([{ columnName: "idempotency_key" }]);

    await sql`
      INSERT INTO message_streams (stream_id, target_type, target_id, last_sequence, created_at)
      VALUES (${"channel:idempotency-default"}, ${"channel"}, ${"idempotency-default"}, 1, now())
    `.execute(getDatabase().db);
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
        ${"message-idempotency-default"},
        ${"channel:idempotency-default"},
        ${1},
        ${"actor-idempotency-default"},
        ${"channel"},
        ${"idempotency-default"},
        ${"key-idempotency-default"},
        ${"hello"},
        now()
      )
    `.execute(getDatabase().db);

    const messages = await sql<{ contentType: string; idempotencyKey: string }>`
      SELECT
        content_type AS "contentType",
        idempotency_key AS "idempotencyKey"
      FROM messages
      WHERE message_id = ${"message-idempotency-default"}
    `.execute(getDatabase().db);
    expect(messages.rows).toEqual([
      {
        contentType: "text",
        idempotencyKey: "key-idempotency-default",
      },
    ]);
  });

  it("enforces the message content type and UTF-8 8KiB constraints", async () => {
    await sql`
      INSERT INTO message_streams (stream_id, target_type, target_id, last_sequence, created_at)
      VALUES (${"channel:constraint-test"}, ${"channel"}, ${"constraint-test"}, 2, now())
    `.execute(getDatabase().db);

    await expect(
      insertMessage({
        messageId: "message-invalid-type",
        sequence: 1,
        contentType: "system",
        contentText: "invalid content type",
      }),
    ).rejects.toThrow("messages_content_type_text_check");

    await expect(
      insertMessage({
        messageId: "message-oversized-content",
        sequence: 2,
        contentType: "text",
        contentText: "a".repeat(8193),
      }),
    ).rejects.toThrow("messages_content_text_utf8_8kib_check");
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
    contentType: string;
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
        content_type,
        content_text,
        sent_at_client,
        created_at
      )
      VALUES (
        ${input.messageId},
        ${"channel:constraint-test"},
        ${input.sequence},
        ${"actor-constraint-test"},
        ${"channel"},
        ${"constraint-test"},
        ${`client-${input.messageId}`},
        ${input.contentType},
        ${input.contentText},
        NULL,
        now()
      )
    `.execute(getDatabase().db);
  }
});
