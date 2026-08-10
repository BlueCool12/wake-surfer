import { createSendMessage } from "@wake-surfer/realtime-chat-message-send";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "../src/realtime-chat-integration-test";

describe("send message PostgreSQL adapter", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("converges concurrent retries to one message and rejects a conflicting payload", async () => {
    let generatedMessage = 0;
    const sendMessage = createSendMessage({
      db: getDatabase().db,
      resolveTarget: () => ({ status: "resolved", streamId: "channel:idempotency" }),
      authorizeWrite: () => ({ status: "allowed" }),
      generateMessageId: () => `message-idempotency-${++generatedMessage}`,
    });
    const request = {
      senderActorId: "actor-idempotency",
      idempotencyKey: "key-idempotency",
      target: { type: "channel" as const, channelId: "idempotency" },
      text: " hello ",
    };

    const concurrentResults = await Promise.all([sendMessage(request), sendMessage(request)]);
    const conflict = await sendMessage({ ...request, text: "different" });
    const acceptedResults = concurrentResults.map((result) => {
      if (result.status !== "accepted") {
        throw new Error("동일한 send 요청은 모두 accepted여야 합니다.");
      }

      return result;
    });

    expect(acceptedResults.map((result) => result.persistence).sort()).toEqual([
      "created",
      "existing",
    ]);
    expect(acceptedResults[0]?.message).toEqual(acceptedResults[1]?.message);
    expect(acceptedResults[0]).toMatchObject({
      message: {
        streamId: "channel:idempotency",
        sequence: 1,
        text: "hello",
      },
    });
    expect(conflict).toEqual({ status: "rejected", reason: "idempotency_conflict" });

    const stored = await sql<{
      messageCount: number;
      receiptCount: number;
      content: unknown;
      fingerprintBytes: number;
    }>`
      SELECT
        count(DISTINCT messages.message_id)::integer AS "messageCount",
        count(DISTINCT receipts.idempotency_key)::integer AS "receiptCount",
        min(messages.content::text)::jsonb AS content,
        min(octet_length(receipts.request_fingerprint))::integer AS "fingerprintBytes"
      FROM messages
      JOIN send_message_receipts AS receipts
        ON receipts.result_message_id = messages.message_id
      WHERE messages.stream_id = ${"channel:idempotency"}
    `.execute(getDatabase().db);

    expect(stored.rows).toEqual([
      {
        messageCount: 1,
        receiptCount: 1,
        content: { schemaVersion: 1, kind: "text", text: "hello" },
        fingerprintBytes: 32,
      },
    ]);
  });

  it("rolls back the allocated sequence when persistence fails", async () => {
    const sendMessage = createSendMessage({
      db: getDatabase().db,
      resolveTarget: () => ({ status: "resolved", streamId: "channel:rollback" }),
      authorizeWrite: () => ({ status: "allowed" }),
      generateMessageId: () => "message-duplicate",
    });

    await expect(
      sendMessage({
        senderActorId: "actor-rollback",
        idempotencyKey: "key-rollback-1",
        target: { type: "channel", channelId: "rollback" },
        text: "first",
      }),
    ).resolves.toMatchObject({ status: "accepted" });
    await expect(
      sendMessage({
        senderActorId: "actor-rollback",
        idempotencyKey: "key-rollback-2",
        target: { type: "channel", channelId: "rollback" },
        text: "second",
      }),
    ).rejects.toThrow();

    const stream = await getDatabase()
      .db.selectFrom("message_streams")
      .select("last_sequence as lastSequence")
      .where("stream_id", "=", "channel:rollback")
      .executeTakeFirstOrThrow();
    expect(stream).toEqual({ lastSequence: 1 });
  });

  it("allocates contiguous sequences under concurrent appends", async () => {
    let generatedMessage = 0;
    const sendMessage = createSendMessage({
      db: getDatabase().db,
      resolveTarget: () => ({ status: "resolved", streamId: "channel:concurrent" }),
      authorizeWrite: () => ({ status: "allowed" }),
      generateMessageId: () => `message-concurrent-${++generatedMessage}`,
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        sendMessage({
          senderActorId: "actor-concurrent",
          idempotencyKey: `key-concurrent-${index + 1}`,
          target: { type: "channel", channelId: "concurrent" },
          text: `message ${index + 1}`,
        }),
      ),
    );
    const sequences = results
      .map((result) => {
        if (result.status !== "accepted") {
          throw new Error("concurrent send가 모두 accepted여야 합니다.");
        }

        return result.message.sequence;
      })
      .sort((left, right) => left - right);

    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  function getDatabase(): RealtimeChatIntegrationTestDatabase {
    if (database === undefined) {
      throw new Error("send message 통합 테스트 database가 준비되지 않았습니다.");
    }

    return database;
  }
});
