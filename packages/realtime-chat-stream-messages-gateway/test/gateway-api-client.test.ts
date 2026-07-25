import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayStreamMessagesApiClient } from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Gateway Stream Messages internal API client", () => {
  it("requires a strong credential and an explicit production TLS proof", () => {
    expect(() => createClient({ gatewayApiToken: "short" })).toThrow(/32 UTF-8 byte/);
    expect(() => createClient({ gatewayApiToken: `${"a".repeat(31)}:` })).toThrow(
      /RFC 6750 Bearer token/,
    );
    expect(() =>
      createClient({ nodeEnvironment: "production", transportSecurity: "development" }),
    ).toThrow(/TLS 증명/);
    expect(() =>
      createClient({
        apiBaseUrl: "http://api.internal/",
        nodeEnvironment: "production",
        transportSecurity: "direct-tls",
      }),
    ).toThrow(/HTTPS/);
  });

  it("sends service auth and server-asserted actor outside the strict request body", async () => {
    const fetchImplementation = vi.fn(async () =>
      response(JSON.stringify(createSyncResponse()), "request-1"),
    );
    const client = createClient({ fetchImplementation });

    const result = await client.syncAfter(
      { channelId: "channel/relay", afterSequence: 0, limit: 50 },
      {
        actorId: "actor-relay",
        requestId: "request-1",
        signal: new AbortController().signal,
      },
    );

    expect(result.nextAfterSequence).toBe(1);
    const [url, init] = fetchImplementation.mock.calls[0]! as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(String(url)).toBe(
      "https://api.internal/v1/internal/realtime-chat/channels/channel%2Frelay/messages/sync-after",
    );
    expect(init.headers).toEqual(
      expect.objectContaining({
        authorization: `Bearer ${"a".repeat(32)}`,
        "x-gateway-id": "gateway-1",
        "x-realtime-chat-actor-id": "actor-relay",
        "x-request-id": "request-1",
      }),
    );
    expect(JSON.parse(String(init.body))).toEqual({ afterSequence: 0, limit: 50 });
    expect(String(init.body)).not.toContain("channel/relay");
    expect(String(init.body)).not.toContain("actor-relay");
  });

  it("preserves domain rate-limit errors and treats invalid correlation as retryable failure", async () => {
    const rateLimited = createClient({
      fetchImplementation: vi.fn(async () =>
        response(
          JSON.stringify({
            status: "error",
            code: "rate_limited",
            message: "Too many requests",
            retryAfterMs: 900,
          }),
          "request-1",
          429,
        ),
      ),
    });

    await expect(sync(rateLimited)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterMs: 900,
      retryable: false,
    });

    const stale = createClient({
      fetchImplementation: vi.fn(async () =>
        response(JSON.stringify(createSyncResponse()), "stale-request"),
      ),
    });
    await expect(sync(stale)).rejects.toMatchObject({
      code: "stream_messages_unavailable",
      retryable: true,
    });
  });

  it("distinguishes timeout from caller cancellation", async () => {
    vi.useFakeTimers();
    const fetchImplementation = () => new Promise<Response>(() => undefined);
    const timedOut = createClient({ fetchImplementation, timeoutMilliseconds: 50 });
    const timeoutResult = sync(timedOut).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    await expect(timeoutResult).resolves.toMatchObject({ code: "timeout", retryable: true });

    const cancelled = createClient({ fetchImplementation, timeoutMilliseconds: 5_000 });
    const controller = new AbortController();
    const cancellationResult = sync(cancelled, controller.signal).catch((error: unknown) => error);
    controller.abort();
    await expect(cancellationResult).resolves.toMatchObject({ code: "cancelled" });
  });
});

function createClient(
  overrides: {
    apiBaseUrl?: string;
    fetchImplementation?: typeof globalThis.fetch;
    gatewayApiToken?: string;
    nodeEnvironment?: "development" | "production" | "test";
    timeoutMilliseconds?: number;
    transportSecurity?: "development" | "direct-tls" | "service-mesh-tls";
  } = {},
) {
  return createGatewayStreamMessagesApiClient({
    apiBaseUrl: overrides.apiBaseUrl ?? "https://api.internal/v1/",
    fetch:
      overrides.fetchImplementation ??
      vi.fn(async () => {
        throw new Error("unexpected fetch");
      }),
    gatewayApiToken: overrides.gatewayApiToken ?? "a".repeat(32),
    gatewayId: "gateway-1",
    nodeEnvironment: overrides.nodeEnvironment ?? "test",
    timeoutMilliseconds: overrides.timeoutMilliseconds ?? 1_000,
    transportSecurity: overrides.transportSecurity ?? "direct-tls",
  });
}

function sync(client: ReturnType<typeof createClient>, signal = new AbortController().signal) {
  return client.syncAfter(
    { channelId: "channel/relay", afterSequence: 0, limit: 50 },
    { actorId: "actor-relay", requestId: "request-1", signal },
  );
}

function response(body: string, requestId: string, status = 200): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
    status,
  });
}

function createSyncResponse() {
  return {
    streamId: "channel:channel/relay",
    afterSequence: 0,
    throughSequence: 1,
    messages: [
      {
        messageId: "message-1",
        streamId: "channel:channel/relay",
        sequence: 1,
        senderActorId: "actor-relay",
        target: { type: "channel" as const, channelId: "channel/relay" },
        content: { type: "text" as const, text: "hello" },
        createdAt: "2026-07-18T00:00:00.000Z",
      },
    ],
    nextAfterSequence: 1,
    hasMoreAfter: false,
  };
}
