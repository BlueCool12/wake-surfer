import {
  ChatStreamSyncEventSchema,
  ChatStreamSyncFailedEventSchema,
  ChatStreamSyncRejectedEventSchema,
  ChatStreamSyncedEventSchema,
  LatestStreamMessagesHttpRequestSchema,
  LatestThreadStreamMessagesHttpRequestSchema,
  LatestStreamMessagesResponseSchema,
  MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  OlderStreamMessagesHttpRequestSchema,
  OlderThreadStreamMessagesHttpRequestSchema,
  OlderStreamMessagesResponseSchema,
  RequestIdSchema,
  StreamMessagesHttpErrorResponseSchema,
  SyncAfterStreamMessagesRequestSchema,
  SyncAfterStreamMessagesResponseSchema,
  type ChatStreamSyncEvent,
  type LatestStreamMessagesHttpRequest,
  type LatestThreadStreamMessagesHttpRequest,
  type OlderStreamMessagesHttpRequest,
  type OlderThreadStreamMessagesHttpRequest,
  type SyncAfterStreamMessagesRequest,
  type SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import { StreamMessagesTransportError } from "./errors.js";

import type { MeasuredTransportResponse, StreamMessagesTransport } from "./transport.js";

export const DEFAULT_STREAM_MESSAGES_TRANSPORT_TIMEOUT_MS = 10_000;

export type AuthenticatedStreamMessagesRealtimeSession = {
  readonly state: "connecting" | "ready" | "closed";
  requestStreamSync: (
    event: ChatStreamSyncEvent,
    context: { signal: AbortSignal },
  ) => Promise<string>;
};

export type BrowserStreamMessagesTransportOptions = {
  apiBaseUrl: string | URL;
  realtimeSession: AuthenticatedStreamMessagesRealtimeSession;
  fetch?: typeof globalThis.fetch;
  createRequestId?: () => string;
  timeoutMilliseconds?: number;
};

export function createBrowserStreamMessagesTransport(
  options: BrowserStreamMessagesTransportOptions,
): StreamMessagesTransport {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const apiBaseUrl = parseApiBaseUrl(options.apiBaseUrl);
  const timeoutMilliseconds = parseTimeout(options.timeoutMilliseconds);
  const createRequestId = options.createRequestId ?? defaultCreateRequestId;

  if (typeof fetchImplementation !== "function") {
    throw new TypeError("Stream Messages HTTP transport에 fetch 구현이 필요합니다.");
  }

  return {
    loadLatest: (request, context) => {
      const parsedRequest =
        "threadId" in request
          ? LatestThreadStreamMessagesHttpRequestSchema.parse(request)
          : LatestStreamMessagesHttpRequestSchema.parse(request);
      return loadHttpPage({
        context,
        createRequestId,
        fetchImplementation,
        responseSchema: LatestStreamMessagesResponseSchema,
        timeoutMilliseconds,
        url: createLatestUrl(apiBaseUrl, parsedRequest),
      });
    },
    loadOlder: (request, context) => {
      const parsedRequest =
        "threadId" in request
          ? OlderThreadStreamMessagesHttpRequestSchema.parse(request)
          : OlderStreamMessagesHttpRequestSchema.parse(request);
      return loadHttpPage({
        context,
        createRequestId,
        fetchImplementation,
        responseSchema: OlderStreamMessagesResponseSchema,
        timeoutMilliseconds,
        url: createOlderUrl(apiBaseUrl, parsedRequest),
      });
    },
    syncAfter: (request, context) =>
      syncAfter(options.realtimeSession, request, context, {
        createRequestId,
        timeoutMilliseconds,
      }),
  };
}

type RuntimeSchema<Output> = {
  safeParse: (
    value: unknown,
  ) => { success: true; data: Output } | { success: false; error: unknown };
};

async function loadHttpPage<Response>(options: {
  context: { signal: AbortSignal };
  createRequestId: () => string;
  fetchImplementation: typeof globalThis.fetch;
  responseSchema: RuntimeSchema<Response>;
  timeoutMilliseconds: number;
  url: URL;
}): Promise<MeasuredTransportResponse<Response>> {
  const requestId = createValidatedRequestId(options.createRequestId);
  const timeout = createTimeoutSignal(options.context.signal, options.timeoutMilliseconds);

  try {
    const response = await raceWithAbort(
      options.fetchImplementation(options.url, {
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-request-id": requestId,
        },
        method: "GET",
        signal: timeout.signal,
      }),
      timeout.signal,
    );
    const rawText = await raceWithAbort(response.text(), timeout.signal);
    const rawUtf8ByteLength = getUtf8ByteLength(rawText);
    assertEnvelopeByteLength(rawUtf8ByteLength);
    assertHttpRequestId(response, requestId);
    const value = parseJson(rawText);

    if (!response.ok) {
      throw mapHttpError(value);
    }

    const parsed = options.responseSchema.safeParse(value);

    if (!parsed.success) {
      throw new StreamMessagesTransportError("protocol_failure");
    }

    return { response: parsed.data, rawUtf8ByteLength };
  } catch (error) {
    throw mapRuntimeError(error, options.context.signal, timeout.didTimeout);
  } finally {
    timeout.dispose();
  }
}

async function syncAfter(
  realtimeSession: AuthenticatedStreamMessagesRealtimeSession,
  request: SyncAfterStreamMessagesRequest,
  context: { signal: AbortSignal },
  options: {
    createRequestId: () => string;
    timeoutMilliseconds: number;
  },
): Promise<MeasuredTransportResponse<SyncAfterStreamMessagesResponse>> {
  const parsedRequest = SyncAfterStreamMessagesRequestSchema.parse(request);

  if (realtimeSession.state !== "ready") {
    throw new StreamMessagesTransportError(
      realtimeSession.state === "closed" ? "socket_closed" : "session_not_ready",
    );
  }

  const requestId = createValidatedRequestId(options.createRequestId);
  const event = ChatStreamSyncEventSchema.parse({ requestId, ...parsedRequest });
  const timeout = createTimeoutSignal(context.signal, options.timeoutMilliseconds);

  try {
    const rawFrame = await raceWithAbort(
      realtimeSession.requestStreamSync(event, {
        signal: timeout.signal,
      }),
      timeout.signal,
    );
    const rawUtf8ByteLength = getUtf8ByteLength(rawFrame);
    assertEnvelopeByteLength(rawUtf8ByteLength);
    const value = parseJson(rawFrame);
    const success = ChatStreamSyncedEventSchema.safeParse(value);

    if (success.success) {
      assertWebSocketRequestId(success.data.requestId, requestId);
      const { requestId: ignoredRequestId, ...responseValue } = success.data;
      void ignoredRequestId;
      const response = SyncAfterStreamMessagesResponseSchema.parse(responseValue);
      return { response, rawUtf8ByteLength };
    }

    const rejected = ChatStreamSyncRejectedEventSchema.safeParse(value);

    if (rejected.success) {
      assertWebSocketRequestId(rejected.data.requestId, requestId);
      throw new StreamMessagesTransportError(rejected.data.code, {
        ...(rejected.data.code === "rate_limited"
          ? { retryAfterMs: rejected.data.retryAfterMs }
          : {}),
      });
    }

    const failed = ChatStreamSyncFailedEventSchema.safeParse(value);

    if (failed.success) {
      assertWebSocketRequestId(failed.data.requestId, requestId);
      throw new StreamMessagesTransportError(failed.data.code, {
        retryable: failed.data.retryable,
      });
    }

    throw new StreamMessagesTransportError("protocol_failure");
  } catch (error) {
    throw mapRuntimeError(error, context.signal, timeout.didTimeout);
  } finally {
    timeout.dispose();
  }
}

function createLatestUrl(
  baseUrl: URL,
  request: LatestStreamMessagesHttpRequest | LatestThreadStreamMessagesHttpRequest,
): URL {
  const [targetKind, targetId] =
    "threadId" in request ? ["threads", request.threadId] : ["channels", request.channelId];

  return new URL(
    `realtime-chat/${targetKind}/${encodeURIComponent(targetId)}/messages/latest`,
    baseUrl,
  );
}

function createOlderUrl(
  baseUrl: URL,
  request: OlderStreamMessagesHttpRequest | OlderThreadStreamMessagesHttpRequest,
): URL {
  const [targetKind, targetId] =
    "threadId" in request ? ["threads", request.threadId] : ["channels", request.channelId];
  const url = new URL(
    `realtime-chat/${targetKind}/${encodeURIComponent(targetId)}/messages/older`,
    baseUrl,
  );
  url.searchParams.set("beforeSequence", String(request.beforeSequence));
  url.searchParams.set("limit", String(request.limit));
  return url;
}

function parseApiBaseUrl(value: string | URL): URL {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Stream Messages API base URL은 HTTP(S)여야 합니다.");
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  return url;
}

function parseTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_STREAM_MESSAGES_TRANSPORT_TIMEOUT_MS;

  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new TypeError("Stream Messages transport timeout은 양의 safe integer여야 합니다.");
  }

  return timeout;
}

function createValidatedRequestId(createRequestId: () => string): string {
  return RequestIdSchema.parse(createRequestId());
}

function defaultCreateRequestId(): string {
  return globalThis.crypto.randomUUID();
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new StreamMessagesTransportError("protocol_failure");
  }
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertEnvelopeByteLength(byteLength: number): void {
  if (byteLength > MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES) {
    throw new StreamMessagesTransportError("protocol_failure");
  }
}

function assertHttpRequestId(response: Response, expectedRequestId: string): void {
  const actualRequestId = response.headers.get("x-request-id");

  if (actualRequestId !== expectedRequestId) {
    throw new StreamMessagesTransportError("stale_response");
  }
}

function assertWebSocketRequestId(actualRequestId: string, expectedRequestId: string): void {
  if (actualRequestId !== expectedRequestId) {
    throw new StreamMessagesTransportError("stale_response");
  }
}

function mapHttpError(value: unknown): StreamMessagesTransportError {
  const parsed = StreamMessagesHttpErrorResponseSchema.safeParse(value);

  if (!parsed.success) {
    return new StreamMessagesTransportError("protocol_failure");
  }

  const error = parsed.data;
  return new StreamMessagesTransportError(error.code, {
    ...(error.code === "rate_limited" ? { retryAfterMs: error.retryAfterMs } : {}),
    ...(error.code === "stream_messages_unavailable" ? { retryable: error.retryable } : {}),
  });
}

function mapRuntimeError(
  error: unknown,
  callerSignal: AbortSignal,
  didTimeout: () => boolean,
): StreamMessagesTransportError {
  if (callerSignal.aborted) {
    return new StreamMessagesTransportError("cancelled");
  }

  if (didTimeout()) {
    return new StreamMessagesTransportError("timeout");
  }

  if (error instanceof StreamMessagesTransportError) {
    return error;
  }

  return new StreamMessagesTransportError("stream_messages_unavailable", {
    retryable: true,
  });
}

function createTimeoutSignal(
  parentSignal: AbortSignal,
  milliseconds: number,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal.reason);

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, milliseconds);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

function raceWithAbort<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      reject(createAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}
