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

  it("applies the initial schema and records the Atlas revision", async () => {
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
    expect(revisions.rows).toEqual([{ count: "1" }]);
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
        client_message_id,
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
