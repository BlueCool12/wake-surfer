import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import { createMessageSendModule } from "@wake-surfer/realtime-chat-message-send";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "../src/realtime-chat-integration-test";

describe("realtime-chat PostgreSQL integration harness", () => {
  let database: RealtimeChatIntegrationTestDatabase | undefined;

  beforeAll(async () => {
    database = await createRealtimeChatIntegrationTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it("boots gateway ticket tables and consumes an issued ticket", async () => {
    const gatewayTicket = createGatewayTicketModule({
      db: getDatabase().db,
      assignGateway: createStaticGatewayAssigner({
        gatewayId: "gateway-integration-test",
        gatewayUrl: "wss://gateway.example.test/realtime-chat",
      }),
      ticketTtlMilliseconds: 60_000,
      rawTicketBytes: 16,
    });

    const issued = await gatewayTicket.issue({
      actorId: "actor-integration-test",
    });
    const consumed = await gatewayTicket.consume(
      {
        ticket: issued.ticket,
      },
      {
        gatewayId: "gateway-integration-test",
      },
    );

    expect(consumed).toMatchObject({
      status: "consumed",
      ticket: {
        actorId: "actor-integration-test",
      },
    });
  });

  it("boots message tables and persists a channel message", async () => {
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
    });

    const result = await messageSend.send(
      {
        clientMessageId: "client-message-integration-test",
        target: {
          type: "channel",
          channelId: "channel-integration-test",
        },
        content: {
          type: "text",
          text: "PostgreSQL integration smoke test",
        },
      },
      {
        actorId: "actor-integration-test",
      },
    );

    expect(result).toMatchObject({
      status: "accepted",
      message: {
        sequence: 1,
        streamId: "channel:channel-integration-test",
      },
    });

    const persisted = await getDatabase()
      .db.selectFrom("messages")
      .select(["stream_id", "sequence", "content_text"])
      .executeTakeFirstOrThrow();

    expect(persisted).toEqual({
      stream_id: "channel:channel-integration-test",
      sequence: 1,
      content_text: "PostgreSQL integration smoke test",
    });
  });

  it("stores text at the UTF-8 8KiB limit and rejects an oversized command", async () => {
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
    });
    const textAtLimit = "a".repeat(8_192);

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-byte-limit",
          target: {
            type: "channel",
            channelId: "channel-byte-limit",
          },
          content: {
            type: "text",
            text: textAtLimit,
          },
        },
        {
          actorId: "actor-byte-limit",
        },
      ),
    ).resolves.toMatchObject({
      status: "accepted",
      message: {
        sequence: 1,
        content: {
          type: "text",
          text: textAtLimit,
        },
      },
    });

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-byte-limit-oversized",
          target: {
            type: "channel",
            channelId: "channel-byte-limit",
          },
          content: {
            type: "text",
            text: "a".repeat(8_193),
          },
        },
        {
          actorId: "actor-byte-limit",
        },
      ),
    ).resolves.toEqual({
      status: "rejected",
      clientMessageId: "client-message-byte-limit-oversized",
      reason: "invalid_content",
    });

    const persisted = await getDatabase()
      .db.selectFrom("messages")
      .select(["sequence", "content_text"])
      .where("stream_id", "=", "channel:channel-byte-limit")
      .execute();

    expect(persisted).toEqual([
      {
        sequence: 1,
        content_text: textAtLimit,
      },
    ]);
  });

  it("rolls back target-mismatched appends", async () => {
    const streamId = "channel:channel-target-mismatch-original";
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
      resolveTarget: () => ({
        status: "resolved",
        streamId,
        recipientActorIds: [],
      }),
    });

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-target-mismatch-original",
          target: {
            type: "channel",
            channelId: "channel-target-mismatch-original",
          },
          content: {
            type: "text",
            text: "original target",
          },
        },
        {
          actorId: "actor-target-mismatch",
        },
      ),
    ).resolves.toMatchObject({
      status: "accepted",
    });

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-target-mismatch-rejected",
          target: {
            type: "channel",
            channelId: "channel-target-mismatch-rejected",
          },
          content: {
            type: "text",
            text: "mismatched target",
          },
        },
        {
          actorId: "actor-target-mismatch",
        },
      ),
    ).rejects.toThrow("기존 메시지 stream의 target이 command target과 일치하지 않습니다.");

    await expect(
      messageSend.send(
        {
          clientMessageId: "client-message-target-mismatch-original",
          target: {
            type: "channel",
            channelId: "channel-target-mismatch-rejected",
          },
          content: {
            type: "text",
            text: "mismatched idempotent retry",
          },
        },
        {
          actorId: "actor-target-mismatch",
        },
      ),
    ).rejects.toThrow("기존 메시지 stream의 target이 command target과 일치하지 않습니다.");

    const stream = await getDatabase()
      .db.selectFrom("message_streams")
      .select(["target_type", "target_id", "last_sequence"])
      .where("stream_id", "=", streamId)
      .executeTakeFirstOrThrow();
    const messages = await getDatabase()
      .db.selectFrom("messages")
      .select(["sequence", "target_type", "target_id"])
      .where("stream_id", "=", streamId)
      .execute();

    expect(stream).toEqual({
      target_type: "channel",
      target_id: "channel-target-mismatch-original",
      last_sequence: 1,
    });
    expect(messages).toEqual([
      {
        sequence: 1,
        target_type: "channel",
        target_id: "channel-target-mismatch-original",
      },
    ]);
  });

  it("keeps invariants for concurrent appends", async () => {
    const concurrentMessageCount = 12;
    const channelId = "channel-concurrent-append";
    const streamId = `channel:${channelId}`;
    const messageSend = createMessageSendModule({
      db: getDatabase().db,
      authorizeWrite: () => ({
        status: "allowed",
      }),
    });

    const results = await Promise.all(
      Array.from({ length: concurrentMessageCount }, (_, index) =>
        messageSend.send(
          {
            clientMessageId: `client-message-concurrent-${index}`,
            target: {
              type: "channel",
              channelId,
            },
            content: {
              type: "text",
              text: `concurrent message ${index}`,
            },
          },
          {
            actorId: "actor-concurrent-append",
          },
        ),
      ),
    );

    for (const result of results) {
      expect(result.status).toBe("accepted");
    }

    const stream = await getDatabase()
      .db.selectFrom("message_streams")
      .select(["target_type", "target_id", "last_sequence"])
      .where("stream_id", "=", streamId)
      .executeTakeFirstOrThrow();
    const messages = await getDatabase()
      .db.selectFrom("messages")
      .select(["sequence", "target_type", "target_id"])
      .where("stream_id", "=", streamId)
      .orderBy("sequence", "asc")
      .execute();

    expect(stream).toEqual({
      target_type: "channel",
      target_id: channelId,
      last_sequence: concurrentMessageCount,
    });
    expect(messages).toEqual(
      Array.from({ length: concurrentMessageCount }, (_, index) => ({
        sequence: index + 1,
        target_type: "channel",
        target_id: channelId,
      })),
    );
  });

  it("creates distinct schemas when setup runs concurrently", async () => {
    const results = await Promise.allSettled([
      createRealtimeChatIntegrationTestDatabase(),
      createRealtimeChatIntegrationTestDatabase(),
    ]);
    const databases = results
      .filter(
        (result): result is PromiseFulfilledResult<RealtimeChatIntegrationTestDatabase> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);

    try {
      const failure = results.find((result) => result.status === "rejected");

      if (failure?.status === "rejected") {
        throw failure.reason;
      }

      expect(new Set(databases.map((item) => item.schemaName)).size).toBe(databases.length);

      await expect(
        databases[0]!.db.selectFrom("gateway_tickets").select("ticket_hash").execute(),
      ).resolves.toEqual([]);
      await expect(
        databases[1]!.db.selectFrom("messages").select("message_id").execute(),
      ).resolves.toEqual([]);
    } finally {
      await Promise.all(databases.map((item) => item.close()));
    }
  });

  function getDatabase(): RealtimeChatIntegrationTestDatabase {
    if (database === undefined) {
      throw new Error("PostgreSQL 통합 테스트 database를 초기화하지 못했습니다.");
    }

    return database;
  }
});
