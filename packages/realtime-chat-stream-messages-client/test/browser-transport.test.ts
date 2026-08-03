import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  type ChatStreamSyncEvent,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import {
  createBrowserStreamMessagesTransport,
  type AuthenticatedStreamMessagesRealtimeSession,
} from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("browser Stream Messages transport", () => {
  it("loads latest with credentials, correlation, strict parsing, and raw byte measurement", async () => {
    const body = JSON.stringify(createLatestResponse());
    const fetchImplementation = vi.fn(async () =>
      jsonResponse(body, { requestId: "request-latest" }),
    );
    const transport = createTransport({
      createRequestId: () => "request-latest",
      fetchImplementation,
    });

    const result = await transport.loadLatest(
      { channelId: "channel-transport" },
      { signal: new AbortController().signal },
    );

    expect(result.response.throughSequence).toBe(2);
    expect(result.rawUtf8ByteLength).toBe(new TextEncoder().encode(body).byteLength);
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL(
        "https://api.example.test/v1/realtime-chat/channels/channel-transport/messages/latest",
      ),
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "x-request-id": "request-latest" }),
        method: "GET",
      }),
    );
  });

  it("builds an encoded older URL without sending client identity hints", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse(
        JSON.stringify({
          streamId: "channel:channel/transport",
          beforeSequence: 1,
          messages: [],
          nextBeforeSequence: null,
          hasMoreBefore: false,
        }),
        { requestId: "request-older" },
      ),
    );
    const transport = createTransport({
      createRequestId: () => "request-older",
      fetchImplementation,
    });

    await transport.loadOlder(
      { channelId: "channel/transport", beforeSequence: 1, limit: 25 },
      { signal: new AbortController().signal },
    );

    const [url, init] = fetchImplementation.mock.calls[0]! as unknown as [
      RequestInfo | URL,
      RequestInit | undefined,
    ];
    expect(String(url)).toBe(
      "https://api.example.test/v1/realtime-chat/channels/channel%2Ftransport/messages/older?beforeSequence=1&limit=25",
    );
    expect(init?.headers).toEqual({
      accept: "application/json",
      "x-request-id": "request-older",
    });
  });

  it("preserves HTTP rate-limit semantics and rejects stale correlation", async () => {
    const rateLimitedTransport = createTransport({
      createRequestId: () => "request-rate",
      fetchImplementation: vi.fn(async () =>
        jsonResponse(
          JSON.stringify({
            status: "error",
            code: "rate_limited",
            message: "Too many requests",
            retryAfterMs: 750,
          }),
          { requestId: "request-rate", status: 429 },
        ),
      ),
    });

    await expect(
      rateLimitedTransport.loadLatest(
        { channelId: "channel-transport" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 750, retryable: false });

    const staleTransport = createTransport({
      createRequestId: () => "request-current",
      fetchImplementation: vi.fn(async () =>
        jsonResponse(JSON.stringify(createLatestResponse()), { requestId: "request-stale" }),
      ),
    });

    await expect(
      staleTransport.loadLatest(
        { channelId: "channel-transport" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "stale_response" });
  });

  it("rejects an oversized HTTP envelope before parsing JSON", async () => {
    const transport = createTransport({
      fetchImplementation: vi.fn(async () =>
        jsonResponse("x".repeat(MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES + 1), {
          requestId: "request-fixed",
        }),
      ),
    });

    await expect(
      transport.loadLatest(
        { channelId: "channel-transport" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "protocol_failure" });
  });

  it("sends sync only through a ready authenticated session and measures the raw frame", async () => {
    const requestStreamSync = vi.fn(async (event: ChatStreamSyncEvent) =>
      JSON.stringify({
        requestId: event.requestId,
        streamId: "channel:channel-transport",
        afterSequence: 2,
        throughSequence: 3,
        messages: [createMessage(3)],
        nextAfterSequence: 3,
        hasMoreAfter: false,
      }),
    );
    const transport = createTransport({
      createRequestId: () => "request-sync",
      realtimeSession: { state: "ready", requestStreamSync },
    });

    const result = await transport.syncAfter(
      { channelId: "channel-transport", afterSequence: 2, limit: 50 },
      { signal: new AbortController().signal },
    );

    expect(result.response.nextAfterSequence).toBe(3);
    expect(result.rawUtf8ByteLength).toBeGreaterThan(0);
    expect(requestStreamSync).toHaveBeenCalledWith(
      {
        requestId: "request-sync",
        channelId: "channel-transport",
        afterSequence: 2,
        limit: 50,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("preserves WebSocket domain rejection and retryable failure semantics", async () => {
    const rejected = createTransport({
      realtimeSession: createReadySession((event) =>
        JSON.stringify({
          requestId: event.requestId,
          code: "rate_limited",
          retryAfterMs: 500,
        }),
      ),
    });

    await expect(sync(rejected)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterMs: 500,
      retryable: false,
    });

    const failed = createTransport({
      realtimeSession: createReadySession((event) =>
        JSON.stringify({
          requestId: event.requestId,
          code: "stream_messages_unavailable",
          retryable: true,
        }),
      ),
    });

    await expect(sync(failed)).rejects.toMatchObject({
      code: "stream_messages_unavailable",
      retryable: true,
    });
  });

  it("rejects stale WebSocket responses and non-ready sessions", async () => {
    const stale = createTransport({
      realtimeSession: createReadySession(() =>
        JSON.stringify({
          requestId: "another-request",
          code: "stream_unavailable",
        }),
      ),
    });
    await expect(sync(stale)).rejects.toMatchObject({ code: "stale_response" });

    const connecting = createTransport({
      realtimeSession: {
        state: "connecting",
        requestStreamSync: vi.fn(),
      },
    });
    await expect(sync(connecting)).rejects.toMatchObject({ code: "session_not_ready" });
  });

  it("distinguishes timeout from caller cancellation even when the session ignores abort", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<string>(() => undefined);
    const timedOut = createTransport({
      realtimeSession: { state: "ready", requestStreamSync: never },
      timeoutMilliseconds: 50,
    });
    const timeoutResult = sync(timedOut).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    await expect(timeoutResult).resolves.toMatchObject({ code: "timeout", retryable: true });

    const cancelled = createTransport({
      realtimeSession: { state: "ready", requestStreamSync: never },
      timeoutMilliseconds: 5_000,
    });
    const controller = new AbortController();
    const cancellationResult = sync(cancelled, controller.signal).catch((error: unknown) => error);
    controller.abort();
    await expect(cancellationResult).resolves.toMatchObject({ code: "cancelled" });
  });
});

function createTransport(options: {
  createRequestId?: () => string;
  fetchImplementation?: typeof globalThis.fetch;
  realtimeSession?: AuthenticatedStreamMessagesRealtimeSession;
  timeoutMilliseconds?: number;
}) {
  return createBrowserStreamMessagesTransport({
    apiBaseUrl: "https://api.example.test/v1/",
    createRequestId: options.createRequestId ?? (() => "request-fixed"),
    fetch:
      options.fetchImplementation ??
      vi.fn(async () => {
        throw new Error("unexpected fetch");
      }),
    realtimeSession:
      options.realtimeSession ??
      createReadySession(() => {
        throw new Error("unexpected sync");
      }),
    ...(options.timeoutMilliseconds === undefined
      ? {}
      : { timeoutMilliseconds: options.timeoutMilliseconds }),
  });
}

function createReadySession(
  createFrame: (event: ChatStreamSyncEvent) => string,
): AuthenticatedStreamMessagesRealtimeSession {
  return {
    state: "ready",
    requestStreamSync: vi.fn(async (event) => createFrame(event)),
  };
}

function sync(
  transport: ReturnType<typeof createTransport>,
  signal = new AbortController().signal,
) {
  return transport.syncAfter(
    { channelId: "channel-transport", afterSequence: 2, limit: 50 },
    { signal },
  );
}

function jsonResponse(body: string, options: { requestId: string; status?: number }): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "x-request-id": options.requestId,
    },
    status: options.status ?? 200,
  });
}

function createLatestResponse() {
  return {
    streamId: "channel:channel-transport",
    throughSequence: 2,
    messages: [createMessage(1), createMessage(2)],
    nextBeforeSequence: 1,
    hasMoreBefore: false,
  };
}

function createMessage(sequence: number) {
  return {
    messageId: `message-${sequence}`,
    streamId: "channel:channel-transport",
    sequence,
    senderActorId: "actor-transport",
    target: { type: "channel" as const, channelId: "channel-transport" },
    content: { type: "text" as const, text: `message ${sequence}` },
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}
