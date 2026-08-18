import {
  LatestStreamMessagesHttpRequestSchema,
  InternalSyncAfterStreamMessagesHttpRequestSchema,
  InternalSyncAfterStreamMessagesHttpResponseSchema,
  MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  OlderStreamMessagesHttpRequestSchema,
  getLatestStreamMessagesHttpResponseUtf8ByteLength,
  getOlderStreamMessagesHttpResponseUtf8ByteLength,
  getChatStreamSyncedEventUtf8ByteLength,
  measureChatStreamSyncedFinalEnvelope,
  measureLatestStreamMessagesHttpFinalEnvelope,
  measureOlderStreamMessagesHttpFinalEnvelope,
  serializeLatestStreamMessagesHttpResponse,
  serializeOlderStreamMessagesHttpResponse,
  type StreamMessagesHttpErrorResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";

import {
  StreamMessagesDataIntegrityError,
  type LoadLatestMessages,
  type LoadOlderMessages,
  type StreamMessagesFailureCode,
  type SyncAfterMessages,
} from "@wake-surfer/realtime-chat-stream-messages";
import {
  fitLatestMessagesPage,
  fitOlderMessagesPage,
  fitSyncAfterMessagesPage,
  StreamMessagesEnvelopeIntegrityError,
} from "./page-policy.js";
import { streamMessagesRequestId } from "./request-id-middleware.js";

import type { StreamMessagesPublicRateLimiter } from "./distributed-rate-limiter.js";

export type StreamMessagesHttpActor = {
  actorId: string;
};

export type StreamMessagesHttpLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type StreamMessagesPublicHttpRouteConfig = {
  authenticateActor: (
    request: Request,
  ) => Promise<StreamMessagesHttpActor> | StreamMessagesHttpActor;
  logger: StreamMessagesHttpLogger;
  getTrustedSourceIp?: (request: Request) => Promise<string> | string;
  rateLimiter?: StreamMessagesPublicRateLimiter;
  timeoutMilliseconds?: number;
};

export type RegisterLoadLatestMessagesHttpRouteConfig = StreamMessagesPublicHttpRouteConfig & {
  loadLatest: LoadLatestMessages;
};

export type RegisterLoadOlderMessagesHttpRouteConfig = StreamMessagesPublicHttpRouteConfig & {
  loadOlder: LoadOlderMessages;
};

export type StreamMessagesHttpGateway = {
  gatewayId: string;
};

export type RegisterStreamMessagesInternalHttpRoutesConfig = {
  authenticateGateway: (
    request: Request,
  ) => Promise<StreamMessagesHttpGateway> | StreamMessagesHttpGateway;
  getAssertedActor: (
    request: Request,
  ) => Promise<StreamMessagesHttpActor> | StreamMessagesHttpActor;
  logger: StreamMessagesHttpLogger;
  syncAfter: SyncAfterMessages;
  timeoutMilliseconds?: number;
};

const MAX_INTERNAL_SYNC_REQUEST_UTF8_BYTES = 16_384;

export function registerLoadLatestMessagesHttpRoute(
  app: Hono,
  config: RegisterLoadLatestMessagesHttpRouteConfig,
): void {
  assertPublicRateLimitConfig(config);

  app.use("/realtime-chat/channels/:channelId/messages/latest", streamMessagesRequestId);
  registerStreamMessagesTimeouts(app, config.timeoutMilliseconds, [
    "/realtime-chat/channels/:channelId/messages/latest",
  ]);

  app.get("/realtime-chat/channels/:channelId/messages/latest", async (context) => {
    const requestId = context.get("requestId");
    assertAllowedQueryParameters(context.req.url, []);
    const actor = await config.authenticateActor(context.req.raw);
    const request = parseLatestRequest(context.req.param("channelId"));
    const target = { type: "channel" as const, channelId: request.channelId };
    const startedAt = performance.now();

    try {
      await enforcePublicRateLimit(config, context.req.raw, actor.actorId);
      const usecaseResult = await config.loadLatest(
        { target },
        {
          actorId: actor.actorId,
        },
      );

      if (usecaseResult.status === "failure") {
        return createStreamMessagesFailureResponse(usecaseResult.code);
      }

      const result = fitLatestMessagesPage(
        target,
        usecaseResult.page,
        measureLatestStreamMessagesHttpFinalEnvelope,
      );
      const serialized = serializeLatestStreamMessagesHttpResponse(result.response);
      assertFinalEnvelope(
        serialized,
        result.envelopeUtf8ByteLength,
        getLatestStreamMessagesHttpResponseUtf8ByteLength(result.response),
      );
      config.logger.info(
        {
          channelId: request.channelId,
          durationMs: elapsedMilliseconds(startedAt),
          hasMore: result.response.hasMoreBefore,
          messageCount: result.response.messages.length,
          query: "latest",
          requestId,
          serializedBytes: result.envelopeUtf8ByteLength,
        },
        "stream messages query completed",
      );

      return createJsonResponse(serialized, 200);
    } catch (error) {
      throw mapStreamMessagesHttpError(error, {
        channelId: request.channelId,
        logger: config.logger,
        query: "latest",
        requestId,
      });
    }
  });
}

export function registerLoadOlderMessagesHttpRoute(
  app: Hono,
  config: RegisterLoadOlderMessagesHttpRouteConfig,
): void {
  assertPublicRateLimitConfig(config);

  app.use("/realtime-chat/channels/:channelId/messages/older", streamMessagesRequestId);
  registerStreamMessagesTimeouts(app, config.timeoutMilliseconds, [
    "/realtime-chat/channels/:channelId/messages/older",
  ]);

  app.get("/realtime-chat/channels/:channelId/messages/older", async (context) => {
    const requestId = context.get("requestId");
    assertAllowedQueryParameters(context.req.url, ["beforeSequence", "limit"]);
    const actor = await config.authenticateActor(context.req.raw);
    const request = parseOlderRequest(context.req.param("channelId"), context.req.url);
    const target = { type: "channel" as const, channelId: request.channelId };
    const startedAt = performance.now();

    try {
      await enforcePublicRateLimit(config, context.req.raw, actor.actorId);
      const usecaseResult = await config.loadOlder(
        {
          target,
          beforeSequence: request.beforeSequence,
          limit: request.limit,
        },
        {
          actorId: actor.actorId,
        },
      );

      if (usecaseResult.status === "failure") {
        return createStreamMessagesFailureResponse(usecaseResult.code);
      }

      const result = fitOlderMessagesPage(
        target,
        usecaseResult.page,
        measureOlderStreamMessagesHttpFinalEnvelope,
      );
      const serialized = serializeOlderStreamMessagesHttpResponse(result.response);
      assertFinalEnvelope(
        serialized,
        result.envelopeUtf8ByteLength,
        getOlderStreamMessagesHttpResponseUtf8ByteLength(result.response),
      );
      config.logger.info(
        {
          channelId: request.channelId,
          durationMs: elapsedMilliseconds(startedAt),
          hasMore: result.response.hasMoreBefore,
          messageCount: result.response.messages.length,
          query: "older",
          requestId,
          serializedBytes: result.envelopeUtf8ByteLength,
        },
        "stream messages query completed",
      );

      return createJsonResponse(serialized, 200);
    } catch (error) {
      throw mapStreamMessagesHttpError(error, {
        channelId: request.channelId,
        logger: config.logger,
        query: "older",
        requestId,
      });
    }
  });
}

async function enforcePublicRateLimit(
  config: StreamMessagesPublicHttpRouteConfig,
  request: Request,
  actorId: string,
): Promise<void> {
  if (config.rateLimiter === undefined || config.getTrustedSourceIp === undefined) {
    return;
  }

  const sourceIp = await config.getTrustedSourceIp(request);
  const decision = await config.rateLimiter.checkPublic({ actorId, sourceIp });

  if (!decision.allowed) {
    throw createHttpError(
      429,
      {
        status: "error",
        code: "rate_limited",
        message: "Stream Messages query rate limit exceeded",
        retryAfterMs: decision.retryAfterMs,
      },
      { "retry-after": String(Math.ceil(decision.retryAfterMs / 1_000)) },
    );
  }
}

function assertPublicRateLimitConfig(config: StreamMessagesPublicHttpRouteConfig): void {
  if ((config.rateLimiter === undefined) !== (config.getTrustedSourceIp === undefined)) {
    throw new TypeError(
      "Stream Messages public rate limiter와 trusted source IP provider는 함께 설정해야 합니다.",
    );
  }
}

export function registerStreamMessagesInternalHttpRoutes(
  app: Hono,
  config: RegisterStreamMessagesInternalHttpRoutesConfig,
): void {
  app.use(
    "/internal/realtime-chat/channels/:channelId/messages/sync-after",
    streamMessagesRequestId,
  );
  registerStreamMessagesTimeouts(app, config.timeoutMilliseconds, [
    "/internal/realtime-chat/channels/:channelId/messages/sync-after",
  ]);

  app.post("/internal/realtime-chat/channels/:channelId/messages/sync-after", async (context) => {
    const requestId = context.get("requestId");
    await config.authenticateGateway(context.req.raw);
    const actor = await config.getAssertedActor(context.req.raw);
    const request = await parseInternalSyncRequest(context.req.param("channelId"), context.req.raw);
    const target = { type: "channel" as const, channelId: request.channelId };
    const startedAt = performance.now();

    try {
      const usecaseResult = await config.syncAfter(
        {
          target,
          afterSequence: request.afterSequence,
          ...(request.throughSequence === undefined
            ? {}
            : { throughSequence: request.throughSequence }),
          limit: request.limit,
        },
        { actorId: actor.actorId },
      );

      if (usecaseResult.status === "failure") {
        return createStreamMessagesFailureResponse(usecaseResult.code);
      }

      const result = fitSyncAfterMessagesPage(target, usecaseResult.page, (response) =>
        measureChatStreamSyncedFinalEnvelope({ requestId, ...response }),
      );
      const clientEvent = { requestId, ...result.response };
      const canonicalClientEventByteLength = getChatStreamSyncedEventUtf8ByteLength(clientEvent);

      if (
        result.envelopeUtf8ByteLength !== canonicalClientEventByteLength ||
        canonicalClientEventByteLength > MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES
      ) {
        throw new StreamMessagesEnvelopeIntegrityError("invalid_envelope_measurement", {
          canonicalByteLength: canonicalClientEventByteLength,
          measuredByteLength: result.envelopeUtf8ByteLength,
        });
      }

      const response = InternalSyncAfterStreamMessagesHttpResponseSchema.parse(result.response);
      config.logger.info(
        {
          channelId: request.channelId,
          durationMs: elapsedMilliseconds(startedAt),
          hasMore: response.hasMoreAfter,
          messageCount: response.messages.length,
          query: "sync-after",
          requestId,
          serializedBytes: result.envelopeUtf8ByteLength,
        },
        "stream messages query completed",
      );
      return createJsonResponse(JSON.stringify(response), 200);
    } catch (error) {
      throw mapStreamMessagesHttpError(error, {
        channelId: request.channelId,
        logger: config.logger,
        query: "sync-after",
        requestId,
      });
    }
  });
}

function registerStreamMessagesTimeouts(
  app: Hono,
  timeoutMilliseconds: number | undefined,
  paths: readonly string[],
): void {
  if (timeoutMilliseconds === undefined) {
    return;
  }

  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new TypeError("Stream Messages HTTP timeout은 양의 safe integer여야 합니다.");
  }

  for (const path of paths) {
    app.use(
      path,
      timeout(timeoutMilliseconds, () =>
        createHttpError(503, {
          status: "error",
          code: "stream_messages_unavailable",
          message: "Stream Messages service unavailable",
          retryable: true,
        }),
      ),
    );
  }
}

function parseLatestRequest(channelId: string) {
  const parsed = LatestStreamMessagesHttpRequestSchema.safeParse({ channelId });

  if (!parsed.success) {
    throw createHttpError(400, {
      status: "error",
      code: "bad_request",
      message: "latest Stream Messages 요청이 올바르지 않습니다.",
    });
  }

  return parsed.data;
}

function parseOlderRequest(channelId: string, requestUrl: string) {
  const searchParams = new URL(requestUrl).searchParams;
  const parsed = OlderStreamMessagesHttpRequestSchema.safeParse({
    channelId,
    beforeSequence: parseDecimalSafeInteger(searchParams, "beforeSequence", true),
    ...(searchParams.has("limit")
      ? { limit: parseDecimalSafeInteger(searchParams, "limit", true) }
      : {}),
  });

  if (!parsed.success) {
    throw createHttpError(400, {
      status: "error",
      code: "bad_request",
      message: "older Stream Messages 요청이 올바르지 않습니다.",
    });
  }

  return parsed.data;
}

async function parseInternalSyncRequest(channelId: string, request: Request) {
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).byteLength > MAX_INTERNAL_SYNC_REQUEST_UTF8_BYTES) {
    throw createHttpError(400, {
      status: "error",
      code: "bad_request",
      message: "sync-after 요청 본문이 너무 큽니다.",
    });
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    throw createHttpError(400, {
      status: "error",
      code: "bad_request",
      message: "sync-after 요청 본문은 올바른 JSON이어야 합니다.",
    });
  }

  if (
    isRecord(body) &&
    ["actorId", "channelId", "streamId"].some((name) => Object.hasOwn(body, name))
  ) {
    throw createHttpError(400, {
      status: "error",
      code: "bad_request",
      message: "sync-after 요청 본문에 server-owned field를 포함할 수 없습니다.",
    });
  }

  const parsed = InternalSyncAfterStreamMessagesHttpRequestSchema.safeParse(
    isRecord(body) ? { ...body, channelId } : body,
  );

  if (!parsed.success) {
    throw createHttpError(400, {
      status: "error",
      code: "bad_request",
      message: "sync-after Stream Messages 요청이 올바르지 않습니다.",
    });
  }

  return parsed.data;
}

function parseDecimalSafeInteger(
  searchParams: URLSearchParams,
  name: string,
  required: boolean,
): number | undefined {
  const values = searchParams.getAll(name);

  if (values.length === 0) {
    if (required) {
      return Number.NaN;
    }
    return undefined;
  }

  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]!)) {
    return Number.NaN;
  }

  const value = Number(values[0]);
  return Number.isSafeInteger(value) ? value : Number.NaN;
}

function assertAllowedQueryParameters(requestUrl: string, allowedNames: readonly string[]): void {
  const allowed = new Set(allowedNames);

  for (const name of new URL(requestUrl).searchParams.keys()) {
    if (!allowed.has(name)) {
      throw createHttpError(400, {
        status: "error",
        code: "bad_request",
        message: "Stream Messages 요청에 허용되지 않은 query field가 있습니다.",
      });
    }
  }
}

function assertFinalEnvelope(
  serialized: string,
  measuredByteLength: number,
  canonicalByteLength: number,
): void {
  if (
    canonicalByteLength !== measuredByteLength ||
    new TextEncoder().encode(serialized).byteLength !== measuredByteLength ||
    measuredByteLength > MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES
  ) {
    throw new StreamMessagesEnvelopeIntegrityError("invalid_envelope_measurement", {
      canonicalByteLength,
      measuredByteLength,
    });
  }
}

function mapStreamMessagesHttpError(
  error: unknown,
  context: {
    channelId: string;
    logger: StreamMessagesHttpLogger;
    query: "latest" | "older" | "sync-after";
    requestId: string;
  },
): HTTPException {
  if (error instanceof HTTPException) {
    return error;
  }

  context.logger.error(
    {
      channelId: context.channelId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      integrityReason:
        error instanceof StreamMessagesDataIntegrityError ||
        error instanceof StreamMessagesEnvelopeIntegrityError
          ? error.reason
          : undefined,
      integrityMetadata:
        error instanceof StreamMessagesDataIntegrityError ||
        error instanceof StreamMessagesEnvelopeIntegrityError
          ? error.metadata
          : undefined,
      query: context.query,
      requestId: context.requestId,
    },
    "stream messages query failed",
  );

  return createHttpError(503, {
    status: "error",
    code: "stream_messages_unavailable",
    message: "Stream Messages service unavailable",
    retryable: true,
  });
}

function createStreamMessagesFailureResponse(code: StreamMessagesFailureCode): Response {
  return code === "stream_unavailable"
    ? createJsonResponse(
        JSON.stringify({
          status: "error",
          code,
          message: "메시지 stream을 조회할 수 없습니다.",
        } satisfies StreamMessagesHttpErrorResponse),
        404,
      )
    : createJsonResponse(
        JSON.stringify({
          status: "error",
          code,
          message: "Stream Messages cursor가 현재 stream 상태와 맞지 않습니다.",
        } satisfies StreamMessagesHttpErrorResponse),
        409,
      );
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createHttpError(
  status: 400 | 404 | 409 | 429 | 503,
  body: StreamMessagesHttpErrorResponse,
  responseHeaders?: HeadersInit,
): HTTPException {
  return new HTTPException(status, {
    res: createJsonResponse(JSON.stringify(body), status, responseHeaders),
  });
}

function createJsonResponse(
  serialized: string,
  status: number,
  responseHeaders?: HeadersInit,
): Response {
  const headers = new Headers(responseHeaders);
  headers.set("content-type", "application/json; charset=UTF-8");

  return new Response(serialized, {
    status,
    headers,
  });
}
