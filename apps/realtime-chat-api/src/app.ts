import { Hono } from "hono";

import {
  ConsumeGatewayTicketRequestBodySchema,
  IssueGatewayTicketRequestBodySchema,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
  IssueGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type { MessageSendModule } from "@wake-surfer/realtime-chat-message-send";
import {
  SendMessageRequestBodySchema,
  type SendMessageResponse,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import type {
  LoadLatestMessages,
  LoadOlderMessages,
  SyncAfterMessages,
} from "@wake-surfer/realtime-chat-stream-messages";
import { sValidator } from "@hono/standard-validator";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";

import {
  registerLoadLatestMessagesHttpRoute,
  registerLoadOlderMessagesHttpRoute,
  registerStreamMessagesInternalHttpRoutes,
} from "./features/stream-messages/routes.js";
import {
  AppHttpError,
  createApiErrorResponse,
  isAppHttpError,
  isRequestDeadlineExceededError,
  type RealtimeChatApiErrorResponse,
} from "./http/errors.js";
import type { RealtimeChatApiEnv } from "./http/env.js";
import { gatewayTicketOperationDeadline } from "./http/gateway-ticket-deadline.js";
import { realtimeChatApiRequestId } from "./http/request-id.js";

export { AppHttpError } from "./http/errors.js";

export type AppLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type GatewayTicketService = {
  consume: (
    request: ConsumeGatewayTicketRequest,
    context: { gatewayId: string },
    operationContext?: { signal?: AbortSignal },
  ) => Promise<ConsumeGatewayTicketResponse>;
  issue: (
    command: { actorId: string },
    operationContext?: { signal?: AbortSignal },
  ) => Promise<IssueGatewayTicketResponse>;
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
  checkReadiness?: () => Promise<void> | void;
  isDraining?: () => boolean;
  loadLatestMessages?: LoadLatestMessages;
  loadOlderMessages?: LoadOlderMessages;
  logger: AppLogger;
  messageSend?: MessageSendModule;
  operationAbortMilliseconds?: number;
  requestBodyLimitBytes?: number;
  requestTimeoutMilliseconds?: number;
  syncAfterMessages?: SyncAfterMessages;
};

const DEFAULT_OPERATION_ABORT_MILLISECONDS = 8_000;
const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 16_384;

export function createRealtimeChatApiApp(deps: RealtimeChatApiAppDeps): Hono<RealtimeChatApiEnv> {
  const {
    authenticateActor,
    authenticateGateway,
    gatewayTicket,
    getAssertedActor,
    logger,
    messageSend,
  } = deps;
  const app = new Hono<RealtimeChatApiEnv>();

  app.use("*", secureHeaders());
  app.use("*", realtimeChatApiRequestId);
  app.use("*", async (context, next) => {
    const startedAt = performance.now();
    await next();
    logger.info(
      {
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        method: context.req.method,
        path: context.req.path,
        requestId: context.get("requestId"),
        status: context.res.status,
      },
      "realtime chat api request completed",
    );
  });

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
    app.use(
      "/internal/realtime-chat/gateway-tickets/consume",
      timeout(
        deps.requestTimeoutMilliseconds,
        () =>
          new HTTPException(503, {
            res: Response.json(
              createApiErrorResponse(
                "gateway_ticket_unavailable",
                "gateway ticket service unavailable",
              ),
              { status: 503 },
            ),
          }),
      ),
    );
  }

  const limitedJsonBody = bodyLimit({
    maxSize: deps.requestBodyLimitBytes ?? DEFAULT_REQUEST_BODY_LIMIT_BYTES,
    onError: (context) =>
      context.json(createApiErrorResponse("bad_request", "request body is too large"), 413),
  });
  app.use("/realtime-chat/gateway-tickets", limitedJsonBody);
  app.use("/internal/realtime-chat/*", limitedJsonBody);

  const gatewayTicketDeadline = gatewayTicketOperationDeadline(
    deps.operationAbortMilliseconds ?? DEFAULT_OPERATION_ABORT_MILLISECONDS,
  );
  app.use("/realtime-chat/gateway-tickets", gatewayTicketDeadline);
  app.use("/internal/realtime-chat/gateway-tickets/consume", gatewayTicketDeadline);

  app.get("/health", (context) => context.json({ status: "ok" as const }));
  app.get("/health/live", (context) => context.json({ status: "ok" as const }));
  app.get("/health/ready", async (context) => {
    if (deps.isDraining?.() === true) {
      return context.json({ status: "not_ready" as const }, 503);
    }

    try {
      await deps.checkReadiness?.();
      return context.json({ status: "ready" as const });
    } catch (error) {
      logger.warn(
        {
          error: serializeError(error),
          requestId: context.get("requestId"),
        },
        "realtime chat api readiness check failed",
      );
      return context.json({ status: "not_ready" as const }, 503);
    }
  });

  app.post("/realtime-chat/gateway-tickets", async (context) => {
    const actor = await authenticateActor(context.req.raw);
    await readIssueGatewayTicketRequest(context.req.raw);

    let issued: IssueGatewayTicketResponse;

    try {
      const operationSignal = context.get("gatewayTicketOperationSignal");
      issued = await gatewayTicket.issue(
        {
          actorId: actor.actorId,
        },
        {
          signal: operationSignal,
        },
      );
    } catch (error) {
      const operationSignal = context.get("gatewayTicketOperationSignal");

      if (operationSignal.aborted && isRequestDeadlineExceededError(operationSignal.reason)) {
        throw operationSignal.reason;
      }

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

  app.post(
    "/internal/realtime-chat/gateway-tickets/consume",
    sValidator("json", ConsumeGatewayTicketRequestBodySchema, (result, context) => {
      if (!result.success) {
        return context.json(
          createApiErrorResponse(
            "bad_request",
            "게이트웨이 티켓 소비 요청 본문이 올바르지 않습니다.",
          ),
          400,
        );
      }
    }),
    async (context) => {
      const gateway = await authenticateGateway(context.req.raw);
      const body = context.req.valid("json");

      let result: ConsumeGatewayTicketResponse;

      try {
        const operationSignal = context.get("gatewayTicketOperationSignal");
        result = await gatewayTicket.consume(
          {
            ticket: body.ticket,
          },
          {
            gatewayId: gateway.gatewayId,
          },
          {
            signal: operationSignal,
          },
        );
      } catch (error) {
        const operationSignal = context.get("gatewayTicketOperationSignal");

        if (operationSignal.aborted && isRequestDeadlineExceededError(operationSignal.reason)) {
          throw operationSignal.reason;
        }

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
    },
  );

  if (messageSend !== undefined && getAssertedActor !== undefined) {
    app.post(
      "/internal/realtime-chat/messages",
      sValidator("json", SendMessageRequestBodySchema, (result, context) => {
        if (!result.success) {
          return context.json(
            createApiErrorResponse("bad_request", "메시지 전송 요청 본문이 올바르지 않습니다."),
            400,
          );
        }
      }),
      async (context) => {
        await authenticateGateway(context.req.raw);
        const actor = await getAssertedActor(context.req.raw);
        const body = context.req.valid("json");
        const command = {
          clientMessageId: body.clientMessageId,
          target: body.target,
          content: body.content,
          ...(body.commandId === undefined ? {} : { commandId: body.commandId }),
          ...(body.sentAtClient === undefined ? {} : { sentAtClient: body.sentAtClient }),
        };

        let result: SendMessageResponse;

        try {
          result = await messageSend.send(command, {
            actorId: actor.actorId,
          });
        } catch (error) {
          throw new AppHttpError(503, "internal_error", "message send service unavailable", {
            cause: error,
          });
        }

        return context.json(result);
      },
    );
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
    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    if (isAppHttpError(error)) {
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

    if (isRequestDeadlineExceededError(error)) {
      return context.json(
        createApiErrorResponse("gateway_ticket_unavailable", "gateway ticket service unavailable"),
        503,
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

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  if (rawBody.length === 0) {
    return undefined;
  }

  return parseJsonBody(rawBody);
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
