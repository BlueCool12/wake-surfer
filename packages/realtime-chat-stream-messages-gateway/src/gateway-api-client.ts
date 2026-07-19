import {
  InternalSyncAfterStreamMessagesHttpRequestSchema,
  InternalSyncAfterStreamMessagesHttpResponseSchema,
  RequestIdSchema,
  StreamMessagesHttpErrorResponseSchema,
  type StreamMessagesErrorCode,
  type SyncAfterStreamMessagesRequest,
  type SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

export const DEFAULT_GATEWAY_STREAM_MESSAGES_API_TIMEOUT_MS = 10_000;

export type GatewayStreamMessagesApiClient = {
  syncAfter: (
    request: SyncAfterStreamMessagesRequest,
    context: {
      actorId: string;
      requestId: string;
      signal: AbortSignal;
    },
  ) => Promise<SyncAfterStreamMessagesResponse>;
};

export type GatewayStreamMessagesApiErrorCode = StreamMessagesErrorCode | "cancelled" | "timeout";

export class GatewayStreamMessagesApiError extends Error {
  readonly code: GatewayStreamMessagesApiErrorCode;
  readonly retryAfterMs: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: GatewayStreamMessagesApiErrorCode,
    options: { retryAfterMs?: number; retryable?: boolean } = {},
  ) {
    super(`Gateway Stream Messages API request failed: ${code}`);
    this.name = "GatewayStreamMessagesApiError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable =
      options.retryable ?? (code === "stream_messages_unavailable" || code === "timeout");
  }
}

export type CreateGatewayStreamMessagesApiClientOptions = {
  apiBaseUrl: string | URL;
  gatewayApiToken: string;
  gatewayId: string;
  nodeEnvironment: "development" | "production" | "test";
  transportSecurity: "development" | "direct-tls" | "service-mesh-tls";
  actorHeader?: string;
  fetch?: typeof globalThis.fetch;
  gatewayIdHeader?: string;
  timeoutMilliseconds?: number;
};

export function createGatewayStreamMessagesApiClient(
  options: CreateGatewayStreamMessagesApiClientOptions,
): GatewayStreamMessagesApiClient {
  const apiBaseUrl = parseApiBaseUrl(options.apiBaseUrl);
  const gatewayApiToken = parseGatewayApiToken(options.gatewayApiToken);
  const gatewayId = parseNonBlank(options.gatewayId, "gatewayId");
  const actorHeader = parseHeaderName(
    options.actorHeader ?? "x-realtime-chat-actor-id",
    "actorHeader",
  );
  const gatewayIdHeader = parseHeaderName(
    options.gatewayIdHeader ?? "x-gateway-id",
    "gatewayIdHeader",
  );
  const timeoutMilliseconds = parseTimeout(options.timeoutMilliseconds);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  assertTransportSecurity(apiBaseUrl, options.nodeEnvironment, options.transportSecurity);

  if (typeof fetchImplementation !== "function") {
    throw new TypeError("Gateway Stream Messages API client에 fetch 구현이 필요합니다.");
  }

  return {
    async syncAfter(request, context) {
      const parsedRequest = InternalSyncAfterStreamMessagesHttpRequestSchema.parse(request);
      const requestId = RequestIdSchema.parse(context.requestId);
      const actorId = parseNonBlank(context.actorId, "actorId");
      const timeout = createTimeoutSignal(context.signal, timeoutMilliseconds);
      const url = new URL(
        `internal/realtime-chat/channels/${encodeURIComponent(
          parsedRequest.channelId,
        )}/messages/sync-after`,
        apiBaseUrl,
      );

      try {
        const response = await raceWithAbort(
          fetchImplementation(url, {
            body: JSON.stringify(parsedRequest),
            headers: {
              accept: "application/json",
              authorization: `Bearer ${gatewayApiToken}`,
              "content-type": "application/json",
              [actorHeader]: actorId,
              [gatewayIdHeader]: gatewayId,
              "x-request-id": requestId,
            },
            method: "POST",
            signal: timeout.signal,
          }),
          timeout.signal,
        );
        const rawText = await raceWithAbort(response.text(), timeout.signal);
        assertRequestId(response, requestId);
        const value = parseJson(rawText);

        if (!response.ok) {
          throw mapHttpError(value);
        }

        const parsed = InternalSyncAfterStreamMessagesHttpResponseSchema.safeParse(value);

        if (!parsed.success) {
          throw new GatewayStreamMessagesApiError("stream_messages_unavailable", {
            retryable: true,
          });
        }

        return parsed.data;
      } catch (error) {
        throw mapRuntimeError(error, context.signal, timeout.didTimeout);
      } finally {
        timeout.dispose();
      }
    },
  };
}

function parseApiBaseUrl(value: string | URL): URL {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Gateway internal API base URL은 HTTP(S)여야 합니다.");
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  return url;
}

function parseGatewayApiToken(value: string): string {
  const token = parseNonBlank(value, "gatewayApiToken");

  if (new TextEncoder().encode(token).byteLength < 32) {
    throw new TypeError("gatewayApiToken은 최소 32 UTF-8 byte여야 합니다.");
  }

  if (/\s/.test(token)) {
    throw new TypeError("gatewayApiToken은 공백을 포함할 수 없습니다.");
  }

  return token;
}

function parseHeaderName(value: string, label: string): string {
  const headerName = parseNonBlank(value, label).toLowerCase();
  new Headers({ [headerName]: "validation" });
  return headerName;
}

function parseNonBlank(value: string, label: string): string {
  const parsed = value.trim();

  if (parsed.length === 0 || parsed !== value) {
    throw new TypeError(`${label}은 공백 없는 문자열이어야 합니다.`);
  }

  return parsed;
}

function parseTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_GATEWAY_STREAM_MESSAGES_API_TIMEOUT_MS;

  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new TypeError("Gateway Stream Messages API timeout은 양의 safe integer여야 합니다.");
  }

  return timeout;
}

function assertTransportSecurity(
  apiBaseUrl: URL,
  nodeEnvironment: CreateGatewayStreamMessagesApiClientOptions["nodeEnvironment"],
  transportSecurity: CreateGatewayStreamMessagesApiClientOptions["transportSecurity"],
): void {
  if (nodeEnvironment === "production" && transportSecurity === "development") {
    throw new TypeError("production Gateway internal API transport에는 TLS 증명이 필요합니다.");
  }

  if (transportSecurity === "direct-tls" && apiBaseUrl.protocol !== "https:") {
    throw new TypeError("direct-tls Gateway internal API URL은 HTTPS여야 합니다.");
  }
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new GatewayStreamMessagesApiError("stream_messages_unavailable", {
      retryable: true,
    });
  }
}

function assertRequestId(response: Response, expectedRequestId: string): void {
  if (response.headers.get("x-request-id") !== expectedRequestId) {
    throw new GatewayStreamMessagesApiError("stream_messages_unavailable", {
      retryable: true,
    });
  }
}

function mapHttpError(value: unknown): GatewayStreamMessagesApiError {
  const parsed = StreamMessagesHttpErrorResponseSchema.safeParse(value);

  if (!parsed.success) {
    return new GatewayStreamMessagesApiError("stream_messages_unavailable", {
      retryable: true,
    });
  }

  const error = parsed.data;
  return new GatewayStreamMessagesApiError(error.code, {
    ...(error.code === "rate_limited" ? { retryAfterMs: error.retryAfterMs } : {}),
    ...(error.code === "stream_messages_unavailable" ? { retryable: error.retryable } : {}),
  });
}

function mapRuntimeError(
  error: unknown,
  callerSignal: AbortSignal,
  didTimeout: () => boolean,
): GatewayStreamMessagesApiError {
  if (callerSignal.aborted) {
    return new GatewayStreamMessagesApiError("cancelled");
  }

  if (didTimeout()) {
    return new GatewayStreamMessagesApiError("timeout", { retryable: true });
  }

  if (error instanceof GatewayStreamMessagesApiError) {
    return error;
  }

  return new GatewayStreamMessagesApiError("stream_messages_unavailable", {
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
    return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(new DOMException("The operation was aborted", "AbortError"));
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
