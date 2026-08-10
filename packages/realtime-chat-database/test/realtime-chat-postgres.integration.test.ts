import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "../src/realtime-chat-integration-test";

describe("realtime-chat PostgreSQL baseline", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("applies the consolidated physical schema to a fresh database", async () => {
    const tables = await sql<{ tableName: string }>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN (
          'gateway_tickets',
          'message_streams',
          'messages',
          'send_message_receipts',
          'message_reactions',
          'stream_read_positions'
        )
      ORDER BY table_name
    `.execute(getDatabase().db);
    const revisions = await sql<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM atlas_schema_revisions
    `.execute(getDatabase().db);
    const messageColumns = await sql<{ columnName: string }>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'messages'
      ORDER BY ordinal_position
    `.execute(getDatabase().db);

    expect(tables.rows.map((row) => row.tableName)).toEqual([
      "gateway_tickets",
      "message_reactions",
      "message_streams",
      "messages",
      "send_message_receipts",
      "stream_read_positions",
    ]);
    expect(revisions.rows).toEqual([{ count: 1 }]);
    expect(messageColumns.rows.map((row) => row.columnName)).toEqual([
      "message_id",
      "stream_id",
      "sequence",
      "sender_actor_id",
      "parent_message_id",
      "version",
      "content",
      "sender_display_snapshot",
      "created_at",
      "edited_at",
      "deleted_at",
    ]);
  });

  it("enforces the message lifecycle and persisted text size at the storage boundary", async () => {
    await insertStream("storage-constraints", 2);

    await expect(
      insertMessage({
        messageId: "message-oversized",
        streamId: "channel:storage-constraints",
        sequence: 1,
        text: "a".repeat(8_193),
      }),
    ).rejects.toThrow("messages_text_utf8_8kib_check");
    await expect(
      sql`
        INSERT INTO messages (
          message_id,
          stream_id,
          sequence,
          sender_actor_id,
          version,
          content,
          deleted_at
        )
        VALUES (
          ${"message-invalid-lifecycle"},
          ${"channel:storage-constraints"},
          2,
          ${"actor-author"},
          2,
          ${textContent("active content")}::jsonb,
          now()
        )
      `.execute(getDatabase().db),
    ).rejects.toThrow("messages_lifecycle_check");
  });

  it("rejects a reply whose parent belongs to another stream", async () => {
    await insertStream("reply-parent", 1);
    await insertStream("reply-child", 1);
    await insertMessage({
      messageId: "message-parent",
      streamId: "channel:reply-parent",
      sequence: 1,
      text: "parent",
    });

    await expect(
      insertMessage({
        messageId: "message-cross-stream-reply",
        streamId: "channel:reply-child",
        sequence: 1,
        parentMessageId: "message-parent",
        text: "reply",
      }),
    ).rejects.toThrow("messages_parent_same_stream_fk");
  });

  function getDatabase(): RealtimeChatIntegrationTestDatabase {
    if (database === undefined) {
      throw new Error("realtime-chat database 통합 테스트가 준비되지 않았습니다.");
    }

    return database;
  }

  async function insertStream(targetId: string, lastSequence: number): Promise<void> {
    await sql`
      INSERT INTO message_streams (target_type, target_id, last_sequence)
      VALUES (${"channel"}, ${targetId}, ${lastSequence})
    `.execute(getDatabase().db);
  }

  async function insertMessage(input: {
    messageId: string;
    streamId: string;
    sequence: number;
    text: string;
    parentMessageId?: string;
  }): Promise<void> {
    await sql`
      INSERT INTO messages (
        message_id,
        stream_id,
        sequence,
        sender_actor_id,
        parent_message_id,
        content
      )
      VALUES (
        ${input.messageId},
        ${input.streamId},
        ${input.sequence},
        ${"actor-author"},
        ${input.parentMessageId ?? null},
        ${textContent(input.text)}::jsonb
      )
    `.execute(getDatabase().db);
  }
});

function textContent(text: string): string {
  return JSON.stringify({ schemaVersion: 1, kind: "text", text });
}
