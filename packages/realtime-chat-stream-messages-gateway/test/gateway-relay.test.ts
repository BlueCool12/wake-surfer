import { describe, expect, it, vi } from "vitest";

import {
  DUPLICATE_STREAM_SYNC_RETRY_AFTER_MS,
  GatewayStreamMessagesApiError,
  MAX_GATEWAY_STREAM_SYNC_INBOUND_UTF8_BYTES,
  registerGatewayStreamMessagesRelay,
  type GatewayStreamMessagesApiClient,
  type GatewayStreamMessagesRuntime,
  type GatewayStreamMessagesSession,
} from "../src/index.js";

describe("Gateway Stream Messages relay", () => {
  it("rejects application events before gateway.connected readiness without calling API", async () => {
    const fixture = createFixture({ state: "authenticating", connectedEventSent: false });
    await fixture.emitSync(createSyncFrame());

    expect(fixture.apiClient.syncAfter).not.toHaveBeenCalled();
    expect(fixture.sent).toEqual([
      expect.objectContaining({
        eventName: "gateway.not_ready",
        payload: { code: "gateway.not_ready" },
      }),
    ]);
  });

  it("strictly rejects client actor/stream hints and closes uncorrelatable input", async () => {
    const fixture = createFixture();
    await fixture.emitSync(
      JSON.stringify({
        requestId: "request-1",
        channelId: "channel-relay",
        afterSequence: 0,
        limit: 50,
        actorId: "forged-actor",
      }),
    );
    expect(fixture.sent.at(-1)).toEqual(
      expect.objectContaining({
        eventName: "chat.stream.sync.rejected",
        payload: { requestId: "request-1", code: "bad_request" },
      }),
    );
    expect(fixture.apiClient.syncAfter).not.toHaveBeenCalled();

    await fixture.emitSync("not-json");
    expect(fixture.closed.at(-1)).toEqual({
      sessionId: "session-1",
      generation: "generation-1",
      code: 1008,
    });
  });

  it("relays exactly one API page with local actor identity and canonical success payload", async () => {
    const fixture = createFixture();
    await fixture.emitSync(createSyncFrame());

    expect(fixture.apiClient.syncAfter).toHaveBeenCalledWith(
      { channelId: "channel-relay", afterSequence: 0, limit: 50 },
      {
        actorId: "actor-local",
        requestId: "request-1",
        signal: expect.any(AbortSignal),
      },
    );
    expect(fixture.sent).toEqual([
      expect.objectContaining({
        eventName: "chat.stream.synced",
        rawPayload: JSON.stringify({
          requestId: "request-1",
          ...createSyncResponse(),
        }),
      }),
    ]);
    expect(fixture.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        messageCount: 1,
        query: "sync-after",
        requestId: "request-1",
        serializedBytes: expect.any(Number),
      }),
      "Gateway Stream Messages relay completed",
    );
    expect(JSON.stringify(fixture.logger.info.mock.calls)).not.toContain("hello");
  });

  it("maps domain rejection and retryable infrastructure failure to separate events", async () => {
    const rejected = createFixture(undefined, {
      syncAfter: vi.fn(async () => {
        throw new GatewayStreamMessagesApiError("rate_limited", { retryAfterMs: 700 });
      }),
    });
    await rejected.emitSync(createSyncFrame());
    expect(rejected.sent.at(-1)).toEqual(
      expect.objectContaining({
        eventName: "chat.stream.sync.rejected",
        payload: { requestId: "request-1", code: "rate_limited", retryAfterMs: 700 },
      }),
    );

    const failed = createFixture(undefined, {
      syncAfter: vi.fn(async () => {
        throw new GatewayStreamMessagesApiError("timeout", { retryable: true });
      }),
    });
    await failed.emitSync(createSyncFrame());
    expect(failed.sent.at(-1)).toEqual(
      expect.objectContaining({
        eventName: "chat.stream.sync.failed",
        payload: {
          requestId: "request-1",
          code: "stream_messages_unavailable",
          retryable: true,
        },
      }),
    );
  });

  it("uses the distributed actor limiter and fails closed when it is unavailable", async () => {
    const limited = createFixture(undefined, undefined, {
      checkPublic: vi.fn(),
      checkSyncActor: vi.fn(async () => ({ allowed: false, retryAfterMs: 800 })),
    });
    await limited.emitSync(createSyncFrame());
    expect(limited.sent.at(-1)).toEqual(
      expect.objectContaining({
        eventName: "chat.stream.sync.rejected",
        payload: { requestId: "request-1", code: "rate_limited", retryAfterMs: 800 },
      }),
    );
    expect(limited.apiClient.syncAfter).not.toHaveBeenCalled();

    const unavailable = createFixture(undefined, undefined, {
      checkPublic: vi.fn(),
      checkSyncActor: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
    });
    await unavailable.emitSync(createSyncFrame());
    expect(unavailable.sent.at(-1)).toEqual(
      expect.objectContaining({
        eventName: "chat.stream.sync.failed",
        payload: expect.objectContaining({ code: "stream_messages_unavailable" }),
      }),
    );
    expect(unavailable.apiClient.syncAfter).not.toHaveBeenCalled();
  });

  it("allows only one in-flight request for the same session and channel", async () => {
    let resolveFirst: ((value: ReturnType<typeof createSyncResponse>) => void) | undefined;
    const fixture = createFixture(undefined, {
      syncAfter: vi.fn(
        () =>
          new Promise<ReturnType<typeof createSyncResponse>>((resolve) => {
            resolveFirst = resolve;
          }),
      ),
    });
    const first = fixture.emitSync(createSyncFrame());
    await Promise.resolve();
    await fixture.emitSync(createSyncFrame("request-2"));

    expect(fixture.apiClient.syncAfter).toHaveBeenCalledTimes(1);
    expect(fixture.sent.at(-1)).toEqual(
      expect.objectContaining({
        eventName: "chat.stream.sync.rejected",
        payload: {
          requestId: "request-2",
          code: "rate_limited",
          retryAfterMs: DUPLICATE_STREAM_SYNC_RETRY_AFTER_MS,
        },
      }),
    );

    resolveFirst?.(createSyncResponse());
    await first;
  });

  it("aborts closed-session requests and discards their late responses", async () => {
    let resolveRequest: ((value: ReturnType<typeof createSyncResponse>) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const fixture = createFixture(undefined, {
      syncAfter: vi.fn(
        (_request, context) =>
          new Promise<ReturnType<typeof createSyncResponse>>((resolve) => {
            requestSignal = context.signal;
            resolveRequest = resolve;
          }),
      ),
    });
    const request = fixture.emitSync(createSyncFrame());
    await Promise.resolve();
    fixture.emitClose();

    expect(requestSignal?.aborted).toBe(true);
    resolveRequest?.(createSyncResponse());
    await request;
    expect(fixture.sent).toEqual([]);
  });

  it("closes oversized frames before parsing", async () => {
    const fixture = createFixture();
    await fixture.emitSync("x".repeat(MAX_GATEWAY_STREAM_SYNC_INBOUND_UTF8_BYTES + 1));
    expect(fixture.closed).toEqual([
      { sessionId: "session-1", generation: "generation-1", code: 1009 },
    ]);
    expect(fixture.apiClient.syncAfter).not.toHaveBeenCalled();
  });
});

function createFixture(
  sessionOverrides: Partial<GatewayStreamMessagesSession> = {},
  apiOverrides: Partial<GatewayStreamMessagesApiClient> = {},
  rateLimiter?: Parameters<typeof registerGatewayStreamMessagesRelay>[0]["rateLimiter"],
) {
  let streamSyncListener: Parameters<GatewayStreamMessagesRuntime["onStreamSync"]>[0] | undefined;
  let sessionClosedListener:
    Parameters<GatewayStreamMessagesRuntime["onSessionClosed"]>[0] | undefined;
  const sent: Array<{
    sessionId: string;
    generation: string;
    eventName: string;
    rawPayload: string;
    payload: unknown;
  }> = [];
  const closed: Array<{ sessionId: string; generation: string; code: number }> = [];
  const session: GatewayStreamMessagesSession = {
    actorId: "actor-local",
    connectedEventSent: true,
    connectionGeneration: "generation-1",
    sessionId: "session-1",
    state: "ready",
    ...sessionOverrides,
  };
  const apiClient: GatewayStreamMessagesApiClient = {
    syncAfter: vi.fn(async () => createSyncResponse()),
    ...apiOverrides,
  };
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const runtime: GatewayStreamMessagesRuntime = {
    closeSession: (sessionId, generation, code) => {
      closed.push({ sessionId, generation, code });
    },
    onSessionClosed: (listener) => {
      sessionClosedListener = listener;
      return () => {
        sessionClosedListener = undefined;
      };
    },
    onStreamSync: (listener) => {
      streamSyncListener = listener;
      return () => {
        streamSyncListener = undefined;
      };
    },
    send: (sessionId, generation, eventName, rawPayload) => {
      sent.push({
        sessionId,
        generation,
        eventName,
        rawPayload,
        payload: JSON.parse(rawPayload) as unknown,
      });
    },
  };
  registerGatewayStreamMessagesRelay({
    apiClient,
    getSession: (sessionId) => (sessionId === session.sessionId ? session : undefined),
    logger,
    ...(rateLimiter === undefined ? {} : { rateLimiter }),
    runtime,
  });

  return {
    apiClient,
    closed,
    logger,
    emitClose: () =>
      sessionClosedListener?.({
        sessionId: session.sessionId,
        connectionGeneration: session.connectionGeneration,
      }),
    emitSync: (rawFrame: string) => {
      if (streamSyncListener === undefined) {
        throw new Error("stream sync listener is not registered");
      }

      return streamSyncListener({
        sessionId: session.sessionId,
        connectionGeneration: session.connectionGeneration,
        rawFrame,
      });
    },
    sent,
  };
}

function createSyncFrame(requestId = "request-1"): string {
  return JSON.stringify({
    requestId,
    channelId: "channel-relay",
    afterSequence: 0,
    limit: 50,
  });
}

function createSyncResponse() {
  return {
    streamId: "channel:channel-relay",
    afterSequence: 0,
    throughSequence: 1,
    messages: [
      {
        messageId: "message-1",
        streamId: "channel:channel-relay",
        sequence: 1,
        senderActorId: "actor-local",
        target: { type: "channel" as const, channelId: "channel-relay" },
        content: { type: "text" as const, text: "hello" },
        createdAt: "2026-07-18T00:00:00.000Z",
      },
    ],
    nextAfterSequence: 1,
    hasMoreAfter: false,
  };
}
