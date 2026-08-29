import {
  ChatStreamSyncEventSchema,
  ChatStreamSyncFailedEventSchema,
  ChatStreamSyncRejectedEventSchema,
  ChatStreamSyncedEventSchema,
  RequestIdSchema,
  serializeChatStreamSyncedEvent,
  type ChatStreamSyncEvent,
  type StreamMessagesDomainRejectionCode,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import {
  GatewayStreamMessagesApiError,
  type GatewayStreamMessagesApiClient,
} from "./gateway-api-client.js";

export const MAX_GATEWAY_STREAM_SYNC_INBOUND_UTF8_BYTES = 16_384;
export const DUPLICATE_STREAM_SYNC_RETRY_AFTER_MS = 100;

export type GatewayStreamMessagesSession = {
  actorId: string;
  connectionGeneration: string;
  connectedEventSent: boolean;
  sessionId: string;
  state: "authenticating" | "ready" | "closed";
};

export type GatewayStreamMessagesRuntime = {
  closeSession: (
    sessionId: string,
    connectionGeneration: string,
    code: 1008 | 1009,
  ) => Promise<void> | void;
  onSessionClosed: (
    listener: (event: { sessionId: string; connectionGeneration: string }) => void,
  ) => () => void;
  onStreamSync: (
    listener: (event: {
      sessionId: string;
      connectionGeneration: string;
      rawFrame: string;
    }) => Promise<void>,
  ) => () => void;
  send: (
    sessionId: string,
    connectionGeneration: string,
    eventName:
      | "gateway.not_ready"
      | "chat.stream.synced"
      | "chat.stream.sync.rejected"
      | "chat.stream.sync.failed",
    rawPayload: string,
  ) => Promise<void> | void;
};

export type GatewayStreamMessagesRelayLogger = {
  error: (metadata: Record<string, unknown>, message: string) => void;
  info: (metadata: Record<string, unknown>, message: string) => void;
  warn: (metadata: Record<string, unknown>, message: string) => void;
};

export type GatewayStreamMessagesRateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterMs: number };

export type GatewayStreamMessagesRateLimiter = {
  checkSyncActor: (context: { actorId: string }) => Promise<GatewayStreamMessagesRateLimitDecision>;
};

export type RegisterGatewayStreamMessagesRelayOptions = {
  apiClient: GatewayStreamMessagesApiClient;
  getSession: (sessionId: string) => GatewayStreamMessagesSession | undefined;
  logger: GatewayStreamMessagesRelayLogger;
  rateLimiter?: GatewayStreamMessagesRateLimiter;
  runtime: GatewayStreamMessagesRuntime;
};

type InFlightRequest = {
  abortController: AbortController;
  connectionGeneration: string;
  requestId: string;
  sessionId: string;
  targetId: string;
  targetType: "channel" | "thread";
};

export function registerGatewayStreamMessagesRelay(
  options: RegisterGatewayStreamMessagesRelayOptions,
): () => void {
  const inFlight = new Map<string, InFlightRequest>();

  const unregisterStreamSync = options.runtime.onStreamSync(async (event) => {
    try {
      await handleStreamSync(options, inFlight, event);
    } catch (error) {
      options.logger.error(
        {
          connectionGeneration: event.connectionGeneration,
          errorName: error instanceof Error ? error.name : "UnknownError",
          sessionId: event.sessionId,
        },
        "Gateway Stream Messages relay failed",
      );
    }
  });
  const unregisterSessionClosed = options.runtime.onSessionClosed((event) => {
    abortSessionRequests(inFlight, event.sessionId, event.connectionGeneration);
  });

  return () => {
    unregisterStreamSync();
    unregisterSessionClosed();

    for (const request of inFlight.values()) {
      request.abortController.abort();
    }

    inFlight.clear();
  };
}

async function handleStreamSync(
  options: RegisterGatewayStreamMessagesRelayOptions,
  inFlight: Map<string, InFlightRequest>,
  input: {
    sessionId: string;
    connectionGeneration: string;
    rawFrame: string;
  },
): Promise<void> {
  const session = options.getSession(input.sessionId);

  if (
    session === undefined ||
    session.connectionGeneration !== input.connectionGeneration ||
    session.state === "closed"
  ) {
    await options.runtime.closeSession(input.sessionId, input.connectionGeneration, 1008);
    return;
  }

  if (session.state !== "ready" || !session.connectedEventSent) {
    await options.runtime.send(
      input.sessionId,
      input.connectionGeneration,
      "gateway.not_ready",
      JSON.stringify({ code: "gateway.not_ready" }),
    );
    return;
  }

  if (getUtf8ByteLength(input.rawFrame) > MAX_GATEWAY_STREAM_SYNC_INBOUND_UTF8_BYTES) {
    await options.runtime.closeSession(input.sessionId, input.connectionGeneration, 1009);
    return;
  }

  const parsedValue = parseJson(input.rawFrame);
  const parsedEvent = ChatStreamSyncEventSchema.safeParse(parsedValue);

  if (!parsedEvent.success) {
    const requestId = readRequestId(parsedValue);

    if (requestId === null) {
      await options.runtime.closeSession(input.sessionId, input.connectionGeneration, 1008);
      return;
    }

    await sendRejected(options.runtime, session, requestId, "bad_request");
    return;
  }

  const event = parsedEvent.data;
  const target = getSyncTarget(event);
  const inFlightKey = createInFlightKey(session.sessionId, target.type, target.id);

  if (inFlight.has(inFlightKey)) {
    await sendRejected(options.runtime, session, event.requestId, "rate_limited", {
      retryAfterMs: DUPLICATE_STREAM_SYNC_RETRY_AFTER_MS,
    });
    return;
  }

  if (options.rateLimiter !== undefined) {
    let decision: GatewayStreamMessagesRateLimitDecision;

    try {
      decision = await options.rateLimiter.checkSyncActor({ actorId: session.actorId });
    } catch {
      await mapAndSendError(
        options,
        session,
        event,
        new GatewayStreamMessagesApiError("stream_messages_unavailable", {
          retryable: true,
        }),
      );
      return;
    }

    if (!decision.allowed) {
      await sendRejected(options.runtime, session, event.requestId, "rate_limited", {
        retryAfterMs: decision.retryAfterMs,
      });
      return;
    }
  }

  const request: InFlightRequest = {
    abortController: new AbortController(),
    connectionGeneration: session.connectionGeneration,
    requestId: event.requestId,
    sessionId: session.sessionId,
    targetId: target.id,
    targetType: target.type,
  };
  inFlight.set(inFlightKey, request);
  const startedAt = performance.now();

  try {
    const apiContext = {
      actorId: session.actorId,
      requestId: event.requestId,
      signal: request.abortController.signal,
    };
    const cursor = {
      afterSequence: event.afterSequence,
      ...(event.throughSequence === undefined ? {} : { throughSequence: event.throughSequence }),
      limit: event.limit,
    };
    const response =
      target.type === "channel"
        ? await options.apiClient.syncAfter({ channelId: target.id, ...cursor }, apiContext)
        : await syncAfterThread(options.apiClient, target.id, cursor, apiContext);

    if (!isCurrentRequest(options, inFlight, inFlightKey, request)) {
      return;
    }

    const clientEvent = ChatStreamSyncedEventSchema.parse({
      requestId: event.requestId,
      ...response,
    });
    const serialized = serializeChatStreamSyncedEvent(clientEvent);
    await options.runtime.send(
      session.sessionId,
      session.connectionGeneration,
      "chat.stream.synced",
      serialized,
    );
    options.logger.info(
      {
        durationMs: elapsedMilliseconds(startedAt),
        hasMore: response.hasMoreAfter,
        messageCount: response.messages.length,
        query: "sync-after",
        requestId: event.requestId,
        serializedBytes: new TextEncoder().encode(serialized).byteLength,
        sessionId: session.sessionId,
        targetId: target.id,
        targetType: target.type,
      },
      "Gateway Stream Messages relay completed",
    );
  } catch (error) {
    if (request.abortController.signal.aborted) {
      return;
    }

    if (!isCurrentRequest(options, inFlight, inFlightKey, request)) {
      return;
    }

    await mapAndSendError(options, session, event, error);
  } finally {
    if (inFlight.get(inFlightKey) === request) {
      inFlight.delete(inFlightKey);
    }
  }
}

async function syncAfterThread(
  apiClient: GatewayStreamMessagesApiClient,
  threadId: string,
  cursor: {
    afterSequence: number;
    throughSequence?: number;
    limit: number;
  },
  context: { actorId: string; requestId: string; signal: AbortSignal },
) {
  if (apiClient.syncAfterThread === undefined) {
    throw new GatewayStreamMessagesApiError("stream_messages_unavailable", {
      retryable: true,
    });
  }

  return apiClient.syncAfterThread({ threadId, ...cursor }, context);
}

async function mapAndSendError(
  options: RegisterGatewayStreamMessagesRelayOptions,
  session: GatewayStreamMessagesSession,
  event: ChatStreamSyncEvent,
  error: unknown,
): Promise<void> {
  const target = getSyncTarget(event);

  if (error instanceof GatewayStreamMessagesApiError) {
    if (isDomainRejection(error.code)) {
      options.logger.warn(
        {
          code: error.code,
          outcome: "domain_rejection",
          requestId: event.requestId,
          sessionId: session.sessionId,
          targetId: target.id,
          targetType: target.type,
        },
        "Gateway Stream Messages request rejected",
      );
      await sendRejected(options.runtime, session, event.requestId, error.code, {
        ...(error.code === "rate_limited" && error.retryAfterMs !== undefined
          ? { retryAfterMs: error.retryAfterMs }
          : {}),
      });
      return;
    }

    if (error.code === "cancelled") {
      return;
    }
  }

  options.logger.warn(
    {
      code: error instanceof GatewayStreamMessagesApiError ? error.code : "unexpected_failure",
      requestId: event.requestId,
      sessionId: session.sessionId,
      targetId: target.id,
      targetType: target.type,
    },
    "Gateway Stream Messages API request failed",
  );
  const clientEvent = ChatStreamSyncFailedEventSchema.parse({
    requestId: event.requestId,
    code: "stream_messages_unavailable",
    retryable: true,
  });
  await options.runtime.send(
    session.sessionId,
    session.connectionGeneration,
    "chat.stream.sync.failed",
    JSON.stringify(clientEvent),
  );
}

async function sendRejected(
  runtime: GatewayStreamMessagesRuntime,
  session: GatewayStreamMessagesSession,
  requestId: string,
  code: StreamMessagesDomainRejectionCode,
  options: { retryAfterMs?: number } = {},
): Promise<void> {
  const clientEvent = ChatStreamSyncRejectedEventSchema.parse({
    requestId,
    code,
    ...(code === "rate_limited" ? { retryAfterMs: options.retryAfterMs } : {}),
  });
  await runtime.send(
    session.sessionId,
    session.connectionGeneration,
    "chat.stream.sync.rejected",
    JSON.stringify(clientEvent),
  );
}

function isCurrentRequest(
  options: RegisterGatewayStreamMessagesRelayOptions,
  inFlight: Map<string, InFlightRequest>,
  inFlightKey: string,
  request: InFlightRequest,
): boolean {
  const currentSession = options.getSession(request.sessionId);
  return (
    inFlight.get(inFlightKey) === request &&
    currentSession?.state === "ready" &&
    currentSession.connectedEventSent &&
    currentSession.connectionGeneration === request.connectionGeneration
  );
}

function abortSessionRequests(
  inFlight: Map<string, InFlightRequest>,
  sessionId: string,
  connectionGeneration: string,
): void {
  for (const [key, request] of inFlight) {
    if (request.sessionId === sessionId && request.connectionGeneration === connectionGeneration) {
      request.abortController.abort();
      inFlight.delete(key);
    }
  }
}

function createInFlightKey(
  sessionId: string,
  targetType: "channel" | "thread",
  targetId: string,
): string {
  return JSON.stringify([sessionId, targetType, targetId]);
}

function getSyncTarget(event: ChatStreamSyncEvent): {
  type: "channel" | "thread";
  id: string;
} {
  return "channelId" in event
    ? { type: "channel", id: event.channelId }
    : { type: "thread", id: event.threadId };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readRequestId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const parsed = RequestIdSchema.safeParse((value as Record<string, unknown>).requestId);
  return parsed.success ? parsed.data : null;
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isDomainRejection(
  code: GatewayStreamMessagesApiError["code"],
): code is StreamMessagesDomainRejectionCode {
  return (
    code === "stream_unavailable" ||
    code === "invalid_cursor" ||
    code === "bad_request" ||
    code === "rate_limited"
  );
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}
