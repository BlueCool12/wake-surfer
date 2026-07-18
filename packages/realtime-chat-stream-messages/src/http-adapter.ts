import { randomUUID } from "node:crypto";

import {
  LatestStreamMessagesHttpRequestSchema,
  InternalSyncAfterStreamMessagesHttpRequestSchema,
  InternalSyncAfterStreamMessagesHttpResponseSchema,
  MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  OlderStreamMessagesHttpRequestSchema,
  RequestIdSchema,
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

import { StreamMessagesDataIntegrityError, StreamMessagesDomainError } from "./errors.js";

import type { StreamMessagesModule } from "./stream-messages-module.js";
import type { StreamMessagesQueryRateLimiter } from "./distributed-rate-limiter.js";

export type StreamMessagesHttpActor = {
  actorId: string;
};

export type StreamMessagesHttpLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type RegisterStreamMessagesPublicHttpRoutesConfig = {
  authenticateActor: (
    request: Request,
  ) => Promise<StreamMessagesHttpActor> | StreamMessagesHttpActor;
  logger: StreamMessagesHttpLogger;
  getTrustedSourceIp?: (request: Request) => Promise<string> | string;
  rateLimiter?: StreamMessagesQueryRateLimiter;
  streamMessages: StreamMessagesModule;
  timeoutMilliseconds?: number;
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
  streamMessages: StreamMessagesModule;
  timeoutMilliseconds?: number;
};

const MAX_INTERNAL_SYNC_REQUEST_UTF8_BYTES = 16_384;

export function registerStreamMessagesPublicHttpRoutes(
  app: Hono,
  config: RegisterStreamMessagesPublicHttpRoutesConfig,
): void {
  if ((config.rateLimiter === undefined) !== (config.getTrustedSourceIp === undefined)) {
    throw new TypeError(
      "Stream Messages public rate limiter와 trusted source IP provider는 함께 설정해야 합니다.",
    );
  }

  registerStreamMessagesTimeouts(app, config.timeoutMilliseconds, [
    "/realtime-chat/channels/:channelId/messages/latest",
    "/realtime-chat/channels/:channelId/messages/older",
  ]);

  app.get("/realtime-chat/channels/:channelId/messages/latest", async (context) => {
    const requestId = getRequestId(context.req.raw);
    assertAllowedQueryParameters(context.req.url, []);
    const actor = await config.authenticateActor(context.req.raw);
    const request = parseLatestRequest(context.req.param("channelId"));

    try {
      await enforcePublicRateLimit(config, context.req.raw, actor.actorId, requestId);
      const result = await config.streamMessages.loadLatest(request, {
        actorId: actor.actorId,
        measureFinalEnvelope: measureLatestStreamMessagesHttpFinalEnvelope,
      });
      const serialized = serializeLatestStreamMessagesHttpResponse(result.response);
      assertFinalEnvelope(
        serialized,
        result.envelopeUtf8ByteLength,
        getLatestStreamMessagesHttpResponseUtf8ByteLength(result.response),
      );

      return createJsonResponse(serialized, 200, requestId);
    } catch (error) {
      throw mapStreamMessagesHttpError(error, {
        channelId: request.channelId,
        logger: config.logger,
        query: "latest",
        requestId,
      });
    }
  });

  app.get("/realtime-chat/channels/:channelId/messages/older", async (context) => {
    const requestId = getRequestId(context.req.raw);
    assertAllowedQueryParameters(context.req.url, ["beforeSequence", "limit"]);
    const actor = await config.authenticateActor(context.req.raw);
    const request = parseOlderRequest(context.req.param("channelId"), context.req.url);

    try {
      await enforcePublicRateLimit(config, context.req.raw, actor.actorId, requestId);
      const result = await config.streamMessages.loadOlder(request, {
        actorId: actor.actorId,
        measureFinalEnvelope: measureOlderStreamMessagesHttpFinalEnvelope,
      });
      const serialized = serializeOlderStreamMessagesHttpResponse(result.response);
      assertFinalEnvelope(
        serialized,
        result.envelopeUtf8ByteLength,
        getOlderStreamMessagesHttpResponseUtf8ByteLength(result.response),
      );

      return createJsonResponse(serialized, 200, requestId);
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
  config: RegisterStreamMessagesPublicHttpRoutesConfig,
  request: Request,
  actorId: string,
  requestId: string,
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
      requestId,
      { "retry-after": String(Math.ceil(decision.retryAfterMs / 1_000)) },
    );
  }
}

export function registerStreamMessagesInternalHttpRoutes(
  app: Hono,
  config: RegisterStreamMessagesInternalHttpRoutesConfig,
): void {
  registerStreamMessagesTimeouts(app, config.timeoutMilliseconds, [
    "/internal/realtime-chat/channels/:channelId/messages/sync-after",
  ]);

  app.post("/internal/realtime-chat/channels/:channelId/messages/sync-after", async (context) => {
    const requestId = getRequestId(context.req.raw);
    await config.authenticateGateway(context.req.raw);
    const actor = await config.getAssertedActor(context.req.raw);
    const request = await parseInternalSyncRequest(
      context.req.param("channelId"),
      context.req.raw,
      requestId,
    );

    try {
      const result = await config.streamMessages.syncAfter(request, {
        actorId: actor.actorId,
        measureFinalEnvelope: (response) =>
          measureChatStreamSyncedFinalEnvelope({ requestId, ...response }),
      });
      const clientEvent = { requestId, ...result.response };
      const canonicalClientEventByteLength = getChatStreamSyncedEventUtf8ByteLength(clientEvent);

      if (
        result.envelopeUtf8ByteLength !== canonicalClientEventByteLength ||
        canonicalClientEventByteLength > MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES
      ) {
        throw new StreamMessagesDataIntegrityError("invalid_envelope_measurement", {
          canonicalByteLength: canonicalClientEventByteLength,
          measuredByteLength: result.envelopeUtf8ByteLength,
        });
      }

      const response = InternalSyncAfterStreamMessagesHttpResponseSchema.parse(result.response);
      return createJsonResponse(JSON.stringify(response), 200, requestId);
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
      timeout(timeoutMilliseconds, (context) =>
        createHttpError(
          503,
          {
            status: "error",
            code: "stream_messages_unavailable",
            message: "Stream Messages service unavailable",
            retryable: true,
          },
          getRequestId(context.req.raw),
        ),
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

async function parseInternalSyncRequest(channelId: string, request: Request, requestId: string) {
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).byteLength > MAX_INTERNAL_SYNC_REQUEST_UTF8_BYTES) {
    throw createHttpError(
      400,
      {
        status: "error",
        code: "bad_request",
        message: "sync-after 요청 본문이 너무 큽니다.",
      },
      requestId,
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    throw createHttpError(
      400,
      {
        status: "error",
        code: "bad_request",
        message: "sync-after 요청 본문은 올바른 JSON이어야 합니다.",
      },
      requestId,
    );
  }

  if (
    isRecord(body) &&
    ["actorId", "channelId", "streamId"].some((name) => Object.hasOwn(body, name))
  ) {
    throw createHttpError(
      400,
      {
        status: "error",
        code: "bad_request",
        message: "sync-after 요청 본문에 server-owned field를 포함할 수 없습니다.",
      },
      requestId,
    );
  }

  const parsed = InternalSyncAfterStreamMessagesHttpRequestSchema.safeParse(
    isRecord(body) ? { ...body, channelId } : body,
  );

  if (!parsed.success) {
    throw createHttpError(
      400,
      {
        status: "error",
        code: "bad_request",
        message: "sync-after Stream Messages 요청이 올바르지 않습니다.",
      },
      requestId,
    );
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

function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");

  if (supplied === null) {
    return randomUUID();
  }

  const parsed = RequestIdSchema.safeParse(supplied);

  if (!parsed.success) {
    throw createHttpError(400, {
      status: "error",
      code: "bad_request",
      message: "x-request-id가 올바르지 않습니다.",
    });
  }

  return parsed.data;
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
    throw new StreamMessagesDataIntegrityError("invalid_envelope_measurement", {
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

  if (error instanceof StreamMessagesDomainError) {
    if (error.code === "stream_unavailable") {
      return createHttpError(
        404,
        {
          status: "error",
          code: "stream_unavailable",
          message: "메시지 stream을 조회할 수 없습니다.",
        },
        context.requestId,
      );
    }

    return createHttpError(
      409,
      {
        status: "error",
        code: "invalid_cursor",
        message: "Stream Messages cursor가 현재 stream 상태와 맞지 않습니다.",
      },
      context.requestId,
    );
  }

  context.logger.error(
    {
      channelId: context.channelId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      integrityReason: error instanceof StreamMessagesDataIntegrityError ? error.reason : undefined,
      query: context.query,
      requestId: context.requestId,
    },
    "stream messages query failed",
  );

  return createHttpError(
    503,
    {
      status: "error",
      code: "stream_messages_unavailable",
      message: "Stream Messages service unavailable",
      retryable: true,
    },
    context.requestId,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createHttpError(
  status: 400 | 404 | 409 | 429 | 503,
  body: StreamMessagesHttpErrorResponse,
  requestId?: string,
  responseHeaders?: HeadersInit,
): HTTPException {
  return new HTTPException(status, {
    res: createJsonResponse(JSON.stringify(body), status, requestId, responseHeaders),
  });
}

function createJsonResponse(
  serialized: string,
  status: number,
  requestId?: string,
  responseHeaders?: HeadersInit,
): Response {
  const headers = new Headers(responseHeaders);
  headers.set("content-type", "application/json; charset=UTF-8");

  if (requestId !== undefined) {
    headers.set("x-request-id", requestId);
  }

  return new Response(serialized, {
    status,
    headers,
  });
}
