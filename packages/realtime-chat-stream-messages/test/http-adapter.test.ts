import {
  getLatestStreamMessagesHttpResponseUtf8ByteLength,
  type LatestStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  registerStreamMessagesInternalHttpRoutes,
  registerStreamMessagesPublicHttpRoutes,
  StreamMessagesDomainError,
  type StreamMessagesHttpLogger,
  type StreamMessagesModule,
} from "../src/index.js";

describe("Stream Messages public HTTP adapter", () => {
  it("serializes latest with the canonical contract and preserves request correlation", async () => {
    const response = createLatestResponse();
    const loadLatest = vi.fn(async () => ({
      response,
      envelopeUtf8ByteLength: getLatestStreamMessagesHttpResponseUtf8ByteLength(response),
    }));
    const app = createApp({ loadLatest });

    const result = await app.request("/realtime-chat/channels/channel-http/messages/latest", {
      headers: {
        "x-actor-id": "actor-http",
        "x-request-id": "request-http-latest",
      },
    });

    expect(result.status).toBe(200);
    expect(result.headers.get("x-request-id")).toBe("request-http-latest");
    await expect(result.json()).resolves.toEqual(response);
    expect(loadLatest).toHaveBeenCalledWith(
      { channelId: "channel-http" },
      expect.objectContaining({
        actorId: "actor-http",
        measureFinalEnvelope: expect.any(Function),
      }),
    );
  });

  it("rejects unknown, duplicate, and out-of-range query fields before calling a handler", async () => {
    const loadLatest = vi.fn();
    const loadOlder = vi.fn();
    const app = createApp({ loadLatest, loadOlder });

    const latest = await app.request(
      "/realtime-chat/channels/channel-http/messages/latest?actorId=client-owned",
      { headers: { "x-actor-id": "actor-http" } },
    );
    const duplicate = await app.request(
      "/realtime-chat/channels/channel-http/messages/older?beforeSequence=2&beforeSequence=3",
      { headers: { "x-actor-id": "actor-http" } },
    );
    const overLimit = await app.request(
      "/realtime-chat/channels/channel-http/messages/older?beforeSequence=2&limit=101",
      { headers: { "x-actor-id": "actor-http" } },
    );

    expect(latest.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(overLimit.status).toBe(400);
    expect(loadLatest).not.toHaveBeenCalled();
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("keeps domain rejection distinct from retryable infrastructure failure", async () => {
    const logger = createLogger();
    const unavailableApp = createApp(
      {
        loadLatest: vi.fn(async () => {
          throw new StreamMessagesDomainError("stream_unavailable");
        }),
      },
      logger,
    );
    const failureApp = createApp(
      {
        loadLatest: vi.fn(async () => {
          throw new Error("sensitive-message-content");
        }),
      },
      logger,
    );

    const unavailable = await unavailableApp.request(
      "/realtime-chat/channels/private-channel/messages/latest",
      { headers: { "x-actor-id": "actor-http", "x-request-id": "request-domain" } },
    );
    const failure = await failureApp.request(
      "/realtime-chat/channels/channel-http/messages/latest",
      { headers: { "x-actor-id": "actor-http", "x-request-id": "request-failure" } },
    );

    expect(unavailable.status).toBe(404);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "stream_unavailable",
      status: "error",
    });
    expect(unavailable.headers.get("x-request-id")).toBe("request-domain");
    expect(failure.status).toBe(503);
    await expect(failure.json()).resolves.toMatchObject({
      code: "stream_messages_unavailable",
      retryable: true,
      status: "error",
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sensitive-message-content");
  });

  it("authenticates Gateway before reading the asserted actor for internal sync", async () => {
    const callOrder: string[] = [];
    const sourceMessage = createLatestResponse().messages[0]!;
    const response = {
      streamId: "channel:channel-sync",
      afterSequence: 0,
      throughSequence: 1,
      messages: [
        {
          ...sourceMessage,
          streamId: "channel:channel-sync",
          target: { type: "channel" as const, channelId: "channel-sync" },
        },
      ],
      nextAfterSequence: 1,
      hasMoreAfter: false,
    };
    const syncAfter = vi.fn<StreamMessagesModule["syncAfter"]>(async (_request, context) => ({
      response,
      envelopeUtf8ByteLength: context.measureFinalEnvelope(response).utf8ByteLength,
    }));
    const app = new Hono();
    registerStreamMessagesInternalHttpRoutes(app, {
      authenticateGateway: () => {
        callOrder.push("gateway");
        return { gatewayId: "gateway-1" };
      },
      getAssertedActor: () => {
        callOrder.push("actor");
        return { actorId: "actor-asserted" };
      },
      logger: createLogger(),
      streamMessages: createStreamMessages({ syncAfter }),
    });

    const result = await app.request(
      "/internal/realtime-chat/channels/channel-sync/messages/sync-after",
      {
        body: JSON.stringify({ afterSequence: 0, limit: 50 }),
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-internal-sync",
        },
        method: "POST",
      },
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("x-request-id")).toBe("request-internal-sync");
    expect(callOrder).toEqual(["gateway", "actor"]);
    expect(syncAfter).toHaveBeenCalledWith(
      { channelId: "channel-sync", afterSequence: 0, limit: 50 },
      expect.objectContaining({ actorId: "actor-asserted" }),
    );
  });

  it("rejects client-owned actor and stream hints on internal sync", async () => {
    const syncAfter = vi.fn<StreamMessagesModule["syncAfter"]>();
    const app = new Hono();
    registerStreamMessagesInternalHttpRoutes(app, {
      authenticateGateway: () => ({ gatewayId: "gateway-1" }),
      getAssertedActor: () => ({ actorId: "actor-asserted" }),
      logger: createLogger(),
      streamMessages: createStreamMessages({ syncAfter }),
    });

    const result = await app.request(
      "/internal/realtime-chat/channels/channel-sync/messages/sync-after",
      {
        body: JSON.stringify({
          actorId: "client-owned-actor",
          channelId: "client-owned-channel",
          afterSequence: 0,
        }),
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-invalid-internal-sync",
        },
        method: "POST",
      },
    );

    expect(result.status).toBe(400);
    expect(result.headers.get("x-request-id")).toBe("request-invalid-internal-sync");
    expect(syncAfter).not.toHaveBeenCalled();
  });
});

function createApp(overrides: Partial<StreamMessagesModule>, logger = createLogger()): Hono {
  const app = new Hono();
  const streamMessages = createStreamMessages(overrides);

  registerStreamMessagesPublicHttpRoutes(app, {
    authenticateActor: (request) => ({
      actorId: request.headers.get("x-actor-id") ?? "",
    }),
    logger,
    streamMessages,
  });

  return app;
}

function createStreamMessages(overrides: Partial<StreamMessagesModule>): StreamMessagesModule {
  return {
    loadLatest:
      overrides.loadLatest ??
      vi.fn(async () => {
        throw new Error("loadLatest was not configured");
      }),
    loadOlder:
      overrides.loadOlder ??
      vi.fn(async () => {
        throw new Error("loadOlder was not configured");
      }),
    syncAfter:
      overrides.syncAfter ??
      vi.fn(async () => {
        throw new Error("syncAfter was not configured");
      }),
  };
}

function createLatestResponse(): LatestStreamMessagesResponse {
  return {
    streamId: "channel:channel-http",
    throughSequence: 1,
    messages: [
      {
        messageId: "message-http-1",
        streamId: "channel:channel-http",
        sequence: 1,
        senderActorId: "actor-message-author",
        target: {
          type: "channel",
          channelId: "channel-http",
        },
        content: {
          type: "text",
          text: "hello",
        },
        createdAt: "2026-07-18T00:00:00.000Z",
      },
    ],
    nextBeforeSequence: 1,
    hasMoreBefore: false,
  };
}

function createLogger() {
  return {
    error: vi.fn<StreamMessagesHttpLogger["error"]>(),
    info: vi.fn<StreamMessagesHttpLogger["info"]>(),
    warn: vi.fn<StreamMessagesHttpLogger["warn"]>(),
  };
}
