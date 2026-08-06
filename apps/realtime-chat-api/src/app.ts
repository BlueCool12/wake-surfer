import { Hono } from "hono";

import type { ApiCommonErrorCode, ApiErrorResponse } from "@wake-surfer/api-contracts";
import {
  ConsumeGatewayTicketRequestBodySchema,
  IssueGatewayTicketRequestBodySchema,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
  IssueGatewayTicketResponse,
  RealtimeChatErrorCode,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import {
  toAcceptedTextMessage,
  type SendMessage,
  type SendMessageResult,
} from "@wake-surfer/realtime-chat-message-send";
import {
  parseSendMessageRequest,
  type InternalSendMessageResponse,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import type {
  LoadLatestMessages,
  LoadOlderMessages,
  SyncAfterMessages,
} from "@wake-surfer/realtime-chat-stream-messages";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";

import {
  registerLoadLatestMessagesHttpRoute,
  registerLoadOlderMessagesHttpRoute,
  registerStreamMessagesInternalHttpRoutes,
} from "./features/stream-messages/routes.js";

export type AppLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type GatewayTicketService = {
  consume: (
    request: ConsumeGatewayTicketRequest,
    context: { gatewayId: string },
  ) => Promise<ConsumeGatewayTicketResponse>;
  issue: (command: { actorId: string }) => Promise<IssueGatewayTicketResponse>;
};

export type AuthenticatedActor = {
  actorId: string;
};

export type AuthenticatedGateway = {
  gatewayId: string;
};

export type RealtimeChatApiAppDeps = {
  authenticateActor: (request: Request) => Promise<AuthenticatedActor> | AuthenticatedActor;
  authenticateGateway: (request: Request) => Promise<AuthenticatedGateway> | AuthenticatedGateway;
  cors?: {
    allowedHeaders: string[];
    allowedOrigins: string[];
  };
  gatewayTicket: GatewayTicketService;
  getAssertedActor?: (request: Request) => Promise<AuthenticatedActor> | AuthenticatedActor;
  gatewayApiToken: string;
  loadLatestMessages?: LoadLatestMessages;
  loadOlderMessages?: LoadOlderMessages;
  logger: AppLogger;
  sendMessage?: SendMessage;
  requestTimeoutMilliseconds?: number;
  syncAfterMessages?: SyncAfterMessages;
};

type RealtimeChatApiErrorCode = RealtimeChatErrorCode | ApiCommonErrorCode;
type RealtimeChatApiErrorResponse = ApiErrorResponse<RealtimeChatApiErrorCode>;

export class AppHttpError extends Error {
  readonly code: RealtimeChatApiErrorCode;
  readonly statusCode: 400 | 401 | 403 | 404 | 500 | 503;

  constructor(
    statusCode: 400 | 401 | 403 | 404 | 500 | 503,
    code: RealtimeChatApiErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createRealtimeChatApiApp(deps: RealtimeChatApiAppDeps): Hono {
  const {
    authenticateActor,
    authenticateGateway,
    gatewayTicket,
    getAssertedActor,
    logger,
    sendMessage,
  } = deps;
  const app = new Hono();

  app.use(
    "/internal/realtime-chat/*",
    bearerAuth({
      token: deps.gatewayApiToken,
      noAuthenticationHeader: {
        message: {
          status: "error",
          code: "unauthenticated",
          message: "authenticated gateway credential is required",
        } satisfies RealtimeChatApiErrorResponse,
      },
      invalidAuthenticationHeader: {
        message: {
          status: "error",
          code: "bad_request",
          message: "gateway Authorization header is invalid",
        } satisfies RealtimeChatApiErrorResponse,
      },
      invalidToken: {
        message: {
          status: "error",
          code: "unauthenticated",
          message: "authenticated gateway credential is required",
        } satisfies RealtimeChatApiErrorResponse,
      },
    }),
  );

  if (deps.cors !== undefined) {
    app.use(
      "/realtime-chat/*",
      cors({
        allowHeaders: deps.cors.allowedHeaders,
        allowMethods: ["GET", "POST", "OPTIONS"],
        credentials: true,
        exposeHeaders: ["x-request-id", "retry-after"],
        origin: deps.cors.allowedOrigins,
      }),
    );
  }

  if (deps.requestTimeoutMilliseconds !== undefined) {
    app.use(
      "/realtime-chat/gateway-tickets",
      timeout(
        deps.requestTimeoutMilliseconds,
        () =>
          new HTTPException(503, {
            res: new Response(
              JSON.stringify({
                code: "gateway_ticket_unavailable",
                message: "gateway ticket service unavailable",
                status: "error",
              } satisfies RealtimeChatApiErrorResponse),
              {
                status: 503,
                headers: { "content-type": "application/json; charset=UTF-8" },
              },
            ),
          }),
      ),
    );
  }

  app.get("/health", (context) => context.json({ status: "ok" as const }));

  app.post("/realtime-chat/gateway-tickets", async (context) => {
    const actor = await authenticateActor(context.req.raw);
    await readIssueGatewayTicketRequest(context.req.raw);

    let issued: IssueGatewayTicketResponse;

    try {
      issued = await gatewayTicket.issue({
        actorId: actor.actorId,
      });
    } catch (error) {
      throw new AppHttpError(
        503,
        "gateway_ticket_unavailable",
        "gateway ticket service unavailable",
        {
          cause: error,
        },
      );
    }

    return context.json(issued, 201);
  });

  app.post("/internal/realtime-chat/gateway-tickets/consume", async (context) => {
    const gateway = await authenticateGateway(context.req.raw);
    const body = await readConsumeGatewayTicketRequest(context.req.raw);

    let result: ConsumeGatewayTicketResponse;

    try {
      result = await gatewayTicket.consume(
        {
          ticket: body.ticket,
        },
        {
          gatewayId: gateway.gatewayId,
        },
      );
    } catch (error) {
      throw new AppHttpError(
        503,
        "gateway_ticket_unavailable",
        "gateway ticket service unavailable",
        {
          cause: error,
        },
      );
    }

    return context.json(result);
  });

  if (sendMessage !== undefined && getAssertedActor !== undefined) {
    app.post("/internal/realtime-chat/messages", async (context) => {
      await authenticateGateway(context.req.raw);
      const actor = await getAssertedActor(context.req.raw);
      const body = await readRequiredJsonBody(context.req.raw);
      const parsed = parseSendMessageRequest(body);

      if (!parsed.ok) {
        throw new AppHttpError(400, "bad_request", parsed.message);
      }

      let result: SendMessageResult;

      try {
        result = await sendMessage({
          senderActorId: actor.actorId,
          idempotencyKey: parsed.value.idempotencyKey,
          target: parsed.value.target,
          text: parsed.value.text,
        });
      } catch (error) {
        throw new AppHttpError(503, "internal_error", "message send service unavailable", {
          cause: error,
        });
      }

      if (result.status === "rejected") {
        return context.json({
          status: "rejected",
          idempotencyKey: parsed.value.idempotencyKey,
          reason: result.reason,
        } satisfies InternalSendMessageResponse);
      }

      return context.json({
        status: "accepted",
        persistence: result.persistence,
        idempotencyKey: parsed.value.idempotencyKey,
        message: toAcceptedTextMessage(result.message),
      } satisfies InternalSendMessageResponse);
    });
  }

  if (deps.loadLatestMessages !== undefined) {
    registerLoadLatestMessagesHttpRoute(app, {
      authenticateActor,
      loadLatest: deps.loadLatestMessages,
      logger,
      ...(deps.requestTimeoutMilliseconds === undefined
        ? {}
        : { timeoutMilliseconds: deps.requestTimeoutMilliseconds }),
    });
  }

  if (deps.loadOlderMessages !== undefined) {
    registerLoadOlderMessagesHttpRoute(app, {
      authenticateActor,
      loadOlder: deps.loadOlderMessages,
      logger,
      ...(deps.requestTimeoutMilliseconds === undefined
        ? {}
        : { timeoutMilliseconds: deps.requestTimeoutMilliseconds }),
    });
  }

  if (deps.syncAfterMessages !== undefined && deps.getAssertedActor !== undefined) {
    registerStreamMessagesInternalHttpRoutes(app, {
      authenticateGateway,
      getAssertedActor: deps.getAssertedActor,
      logger,
      syncAfter: deps.syncAfterMessages,
      ...(deps.requestTimeoutMilliseconds === undefined
        ? {}
        : { timeoutMilliseconds: deps.requestTimeoutMilliseconds }),
    });
  }

  app.notFound((context) =>
    context.json(
      {
        code: "bad_request",
        message: "route not found",
        status: "error",
      } satisfies RealtimeChatApiErrorResponse,
      404,
    ),
  );

  app.onError((error, context) => {
    const httpExceptionResponse = getHttpExceptionResponse(error);

    if (httpExceptionResponse !== undefined) {
      return httpExceptionResponse;
    }

    if (error instanceof AppHttpError) {
      if (error.statusCode >= 500) {
        logRequestFailure(
          logger,
          error,
          context.req.method,
          context.req.path,
          context.req.header("x-request-id"),
        );
      }

      return context.json(
        {
          code: error.code,
          message: error.message,
          status: "error",
        } satisfies RealtimeChatApiErrorResponse,
        error.statusCode,
      );
    }

    logRequestFailure(
      logger,
      error,
      context.req.method,
      context.req.path,
      context.req.header("x-request-id"),
    );

    return context.json(
      {
        code: "internal_error",
        message: "realtime chat API unavailable",
        status: "error",
      } satisfies RealtimeChatApiErrorResponse,
      500,
    );
  });

  return app;
}

function getHttpExceptionResponse(error: unknown): Response | undefined {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  if (!(error instanceof Error)) {
    return undefined;
  }

  const candidate = error as Error & {
    getResponse?: () => unknown;
    status?: unknown;
  };

  if (
    typeof candidate.getResponse !== "function" ||
    typeof candidate.status !== "number" ||
    !Number.isInteger(candidate.status) ||
    candidate.status < 400 ||
    candidate.status > 599
  ) {
    return undefined;
  }

  const response = candidate.getResponse();
  return response instanceof Response ? response : undefined;
}

function logRequestFailure(
  logger: AppLogger,
  error: unknown,
  method: string,
  path: string,
  requestId: string | undefined,
): void {
  logger.error(
    {
      error: serializeError(error),
      method,
      path,
      requestId: requestId ?? null,
    },
    "realtime chat api request failed",
  );
}

async function readIssueGatewayTicketRequest(request: Request): Promise<void> {
  const body = await readOptionalJsonBody(request);

  if (body === undefined || body === null) {
    return;
  }

  const parsed = IssueGatewayTicketRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    throw new AppHttpError(
      400,
      "bad_request",
      "게이트웨이 티켓 발급 요청 본문에는 클라이언트가 소유한 actor 또는 workspace 필드를 포함할 수 없습니다.",
    );
  }
}

async function readConsumeGatewayTicketRequest(
  request: Request,
): Promise<ConsumeGatewayTicketRequest> {
  const body = await readRequiredJsonBody(request);
  const parsed = ConsumeGatewayTicketRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    throw new AppHttpError(
      400,
      "bad_request",
      "게이트웨이 티켓 소비 요청 본문이 올바르지 않습니다.",
    );
  }

  return parsed.data;
}

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  if (rawBody.length === 0) {
    return undefined;
  }

  return parseJsonBody(rawBody);
}

async function readRequiredJsonBody(request: Request): Promise<unknown> {
  try {
    return parseJsonBody(await request.text());
  } catch {
    throw new AppHttpError(400, "bad_request", "request body must be valid JSON");
  }
}

function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new AppHttpError(400, "bad_request", "request body must be valid JSON");
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    value: String(error),
  };
}
