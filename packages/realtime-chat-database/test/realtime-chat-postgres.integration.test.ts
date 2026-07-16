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
