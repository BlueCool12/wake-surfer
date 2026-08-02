import {
  RequestIdSchema,
  type LatestStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  type LoadLatestMessages,
  type LoadLatestMessagesResult,
  type LoadOlderMessages,
  type SyncAfterMessages,
} from "@wake-surfer/realtime-chat-stream-messages";
import {
  registerLoadLatestMessagesHttpRoute,
  registerLoadOlderMessagesHttpRoute,
  registerStreamMessagesInternalHttpRoutes,
  type StreamMessagesHttpLogger,
} from "../src/features/stream-messages/routes.js";

type StreamMessagesHandlers = {
  loadLatest: LoadLatestMessages;
  loadOlder: LoadOlderMessages;
  syncAfter: SyncAfterMessages;
};

describe("Stream Messages public HTTP adapter", () => {
  it("serializes latest with the canonical contract and preserves request correlation", async () => {
    const response = createLatestResponse();
    const loadLatest = vi.fn<LoadLatestMessages>(async () => createLatestResult());
    const logger = createLogger();
    const app = createApp({ loadLatest }, logger);

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
      { actorId: "actor-http" },
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        hasMore: false,
        messageCount: 1,
        query: "latest",
        requestId: "request-http-latest",
        serializedBytes: expect.any(Number),
      }),
      "stream messages query completed",
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("hello");
  });

  it("generates a missing request ID and rejects an invalid supplied ID before the handler", async () => {
    const loadLatest = vi.fn<LoadLatestMessages>(async () => createLatestResult());
    const app = createApp({ loadLatest });

    const generated = await app.request("/realtime-chat/channels/channel-http/messages/latest", {
      headers: { "x-actor-id": "actor-http" },
    });
    const rejected = await app.request("/realtime-chat/channels/channel-http/messages/latest", {
      headers: {
        "x-actor-id": "actor-http",
        "x-request-id": " ",
      },
    });

    expect(generated.status).toBe(200);
    expect(RequestIdSchema.safeParse(generated.headers.get("x-request-id")).success).toBe(true);
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get("x-request-id")).toBeNull();
    await expect(rejected.json()).resolves.toMatchObject({
      code: "bad_request",
      status: "error",
    });
    expect(loadLatest).toHaveBeenCalledOnce();
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

  it("keeps domain rejection values distinct from retryable infrastructure failure", async () => {
    const logger = createLogger();
    const unavailableApp = createApp(
      {
        loadLatest: vi.fn<LoadLatestMessages>(async () => ({
          status: "failure",
          code: "stream_unavailable",
        })),
      },
      logger,
    );
    const invalidCursorApp = createApp({
      loadOlder: vi.fn<LoadOlderMessages>(async () => ({
        status: "failure",
        code: "invalid_cursor",
      })),
    });
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
    const invalidCursor = await invalidCursorApp.request(
      "/realtime-chat/channels/channel-http/messages/older?beforeSequence=2",
      { headers: { "x-actor-id": "actor-http", "x-request-id": "request-cursor" } },
    );

    expect(unavailable.status).toBe(404);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "stream_unavailable",
      status: "error",
    });
    expect(unavailable.headers.get("x-request-id")).toBe("request-domain");
    expect(invalidCursor.status).toBe(409);
    await expect(invalidCursor.json()).resolves.toMatchObject({
      code: "invalid_cursor",
      status: "error",
    });
    expect(invalidCursor.headers.get("x-request-id")).toBe("request-cursor");
    expect(failure.status).toBe(503);
    await expect(failure.json()).resolves.toMatchObject({
      code: "stream_messages_unavailable",
      retryable: true,
      status: "error",
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sensitive-message-content");
  });

  it("enforces actor and trusted source-IP rate limits with retry metadata", async () => {
    const app = new Hono();
    const loadLatest = vi.fn();
    const checkPublic = vi.fn(async () => ({ allowed: false as const, retryAfterMs: 1_250 }));
    registerLoadLatestMessagesHttpRoute(app, {
      authenticateActor: () => ({ actorId: "actor-rate" }),
      getTrustedSourceIp: () => "203.0.113.5",
      logger: createLogger(),
      rateLimiter: {
        checkPublic,
      },
      loadLatest,
    });

    const result = await app.request("/realtime-chat/channels/channel-http/messages/latest", {
      headers: {
        "x-forwarded-for": "client-forged-ip",
        "x-request-id": "request-rate",
      },
    });

    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("2");
    await expect(result.json()).resolves.toMatchObject({
      code: "rate_limited",
      retryAfterMs: 1_250,
    });
    expect(checkPublic).toHaveBeenCalledWith({
      actorId: "actor-rate",
      sourceIp: "203.0.113.5",
    });
    expect(loadLatest).not.toHaveBeenCalled();
  });

  it("fails public queries closed when the distributed limiter is unavailable", async () => {
    const app = new Hono();
    const loadLatest = vi.fn();
    registerLoadLatestMessagesHttpRoute(app, {
      authenticateActor: () => ({ actorId: "actor-rate" }),
      getTrustedSourceIp: () => "203.0.113.5",
      logger: createLogger(),
      rateLimiter: {
        checkPublic: vi.fn(async () => {
          throw new Error("redis unavailable");
        }),
      },
      loadLatest,
    });

    const result = await app.request("/realtime-chat/channels/channel-http/messages/latest");
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({
      code: "stream_messages_unavailable",
      retryable: true,
    });
    expect(loadLatest).not.toHaveBeenCalled();
  });

  it("authenticates Gateway before reading the asserted actor for internal sync", async () => {
    const callOrder: string[] = [];
    const syncAfter = vi.fn<SyncAfterMessages>(async () => ({
      status: "success",
      page: {
        afterSequence: 0,
        throughSequence: 1,
        messages: [createStreamMessage(1)],
        nextAfterSequence: 1,
        hasMoreAfter: false,
      },
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
      syncAfter,
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
    const syncAfter = vi.fn<SyncAfterMessages>();
    const app = new Hono();
    registerStreamMessagesInternalHttpRoutes(app, {
      authenticateGateway: () => ({ gatewayId: "gateway-1" }),
      getAssertedActor: () => ({ actorId: "actor-asserted" }),
      logger: createLogger(),
      syncAfter,
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

function createApp(overrides: Partial<StreamMessagesHandlers>, logger = createLogger()): Hono {
  const app = new Hono();
  const handlers = createStreamMessagesHandlers(overrides);

  registerLoadLatestMessagesHttpRoute(app, {
    authenticateActor: (request) => ({
      actorId: request.headers.get("x-actor-id") ?? "",
    }),
    logger,
    loadLatest: handlers.loadLatest,
  });
  registerLoadOlderMessagesHttpRoute(app, {
    authenticateActor: (request) => ({
      actorId: request.headers.get("x-actor-id") ?? "",
    }),
    logger,
    loadOlder: handlers.loadOlder,
  });

  return app;
}

function createStreamMessagesHandlers(
  overrides: Partial<StreamMessagesHandlers>,
): StreamMessagesHandlers {
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
        text: "hello",
        createdAt: "2026-07-18T00:00:00.000Z",
      },
    ],
    nextBeforeSequence: 1,
    hasMoreBefore: false,
  };
}

function createLatestResult(): LoadLatestMessagesResult {
  return {
    status: "success",
    page: {
      throughSequence: 1,
      messages: [createStreamMessage(1)],
      nextBeforeSequence: 1,
      hasMoreBefore: false,
    },
  };
}

function createStreamMessage(sequence: number) {
  return {
    messageId: `message-http-${sequence}`,
    sequence,
    senderActorId: "actor-message-author",
    text: "hello",
    createdAt: new Date("2026-07-18T00:00:00.000Z"),
  };
}

function createLogger() {
  return {
    error: vi.fn<StreamMessagesHttpLogger["error"]>(),
    info: vi.fn<StreamMessagesHttpLogger["info"]>(),
    warn: vi.fn<StreamMessagesHttpLogger["warn"]>(),
  };
}
