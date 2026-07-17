import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";

import type { GatewayTicketOperationContext } from "@wake-surfer/realtime-chat-gateway-ticket";
import {
  ConsumeGatewayTicketRequestBodySchema,
  IssueGatewayTicketRequestBodySchema,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
  IssueGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

import {
  createAppHttpError,
  createGatewayTicketErrorResponse,
  isAppHttpError,
  isRequestDeadlineExceededError,
} from "./http/errors.js";
import {
  gatewayTicketOperationDeadline,
  type GatewayTicketDeadlineVariables,
} from "./http/gateway-ticket-deadline.js";

export type AppLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type GatewayTicketService = {
  consume: (
    request: ConsumeGatewayTicketRequest,
    context: { gatewayId: string },
    operationContext: GatewayTicketOperationContext,
  ) => Promise<ConsumeGatewayTicketResponse>;
  issue: (
    command: { actorId: string },
    operationContext: GatewayTicketOperationContext,
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
  checkReadiness: () => Promise<void> | void;
  gatewayTicket: GatewayTicketService;
  logger: AppLogger;
};

export type RealtimeChatApiAppOptions = {
  corsOrigins: string[];
  handlerTimeoutMilliseconds: number;
  isDraining: () => boolean;
  operationAbortMilliseconds: number;
  requestBodyLimitBytes: number;
};

const defaultOptions: RealtimeChatApiAppOptions = {
  corsOrigins: [],
  handlerTimeoutMilliseconds: 5_000,
  isDraining: () => false,
  operationAbortMilliseconds: 3_000,
  requestBodyLimitBytes: 16_384,
};

export function createRealtimeChatApiApp(
  deps: RealtimeChatApiAppDeps,
  options: Partial<RealtimeChatApiAppOptions> = {},
) {
  const { authenticateActor, authenticateGateway, gatewayTicket, logger } = deps;
  const runtimeOptions = {
    ...defaultOptions,
    ...options,
  };
  const app = new Hono<{
    Variables: RequestIdVariables & GatewayTicketDeadlineVariables;
  }>();

  app.use("*", requestId({ limitLength: 128 }));
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    const startedAt = performance.now();
    await next();

    const currentRequestId = context.get("requestId");
    context.header("x-request-id", currentRequestId);
    logger.info(
      {
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        method: context.req.method,
        path: context.req.path,
        requestId: currentRequestId,
        status: context.res.status,
      },
      "realtime chat api request completed",
    );
  });

  if (runtimeOptions.corsOrigins.length > 0) {
    app.use(
      "/realtime-chat/*",
      cors({
        allowHeaders: ["content-type", "x-request-id"],
        allowMethods: ["POST", "OPTIONS"],
        exposeHeaders: ["x-request-id"],
        maxAge: 600,
        origin: runtimeOptions.corsOrigins,
      }),
    );
  }

  const limitedJsonBody = bodyLimit({
    maxSize: runtimeOptions.requestBodyLimitBytes,
    onError: (context) =>
      context.json(
        createGatewayTicketErrorResponse("bad_request", "request body is too large"),
        413,
      ),
  });
  const boundedHandler = timeout(
    runtimeOptions.handlerTimeoutMilliseconds,
    () =>
      new HTTPException(504, {
        res: Response.json(
          createGatewayTicketErrorResponse(
            "gateway_ticket_unavailable",
            "gateway ticket request timed out",
          ),
          { status: 504 },
        ),
      }),
  );
  const operationDeadline = gatewayTicketOperationDeadline(
    runtimeOptions.operationAbortMilliseconds,
  );

  app.get("/health", (context) => context.json({ status: "ok" as const }));
  app.get("/health/live", (context) => context.json({ status: "ok" as const }));
  app.get("/health/ready", async (context) => {
    if (runtimeOptions.isDraining()) {
      return context.json({ status: "not_ready" as const }, 503);
    }

    try {
      await deps.checkReadiness();
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

  app.post(
    "/realtime-chat/gateway-tickets",
    limitedJsonBody,
    boundedHandler,
    operationDeadline,
    async (context) => {
      const actor = await authenticateActor(context.req.raw);
      await readIssueGatewayTicketRequest(context.req.raw);

      const issued = await gatewayTicket.issue(
        {
          actorId: actor.actorId,
        },
        {
          signal: context.get("gatewayTicketOperationSignal"),
        },
      );

      return context.json(issued, 201);
    },
  );

  app.post(
    "/internal/realtime-chat/gateway-tickets/consume",
    limitedJsonBody,
    boundedHandler,
    operationDeadline,
    async (context) => {
      const [gateway, body] = await Promise.all([
        authenticateGateway(context.req.raw),
        readConsumeGatewayTicketRequest(context.req.raw),
      ]);

      const result = await gatewayTicket.consume(
        {
          ticket: body.ticket,
        },
        {
          gatewayId: gateway.gatewayId,
        },
        {
          signal: context.get("gatewayTicketOperationSignal"),
        },
      );

      return context.json(result);
    },
  );

  app.notFound((context) =>
    context.json(createGatewayTicketErrorResponse("bad_request", "route not found"), 404),
  );

  app.onError((error, context) => {
    if (isAppHttpError(error)) {
      return context.json(
        createGatewayTicketErrorResponse(error.code, error.message),
        error.statusCode,
      );
    }

    if (isRequestDeadlineExceededError(error)) {
      return context.json(
        createGatewayTicketErrorResponse(
          "gateway_ticket_unavailable",
          "gateway ticket request timed out",
        ),
        504,
      );
    }

    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    logger.error(
      {
        error: serializeError(error),
        method: context.req.method,
        path: context.req.path,
        requestId: context.get("requestId"),
      },
      "realtime chat api request failed",
    );

    return context.json(
      createGatewayTicketErrorResponse(
        "gateway_ticket_unavailable",
        "gateway ticket service unavailable",
      ),
      500,
    );
  });

  return app;
}

async function readIssueGatewayTicketRequest(request: Request): Promise<void> {
  const body = await readOptionalJsonBody(request);

  if (body === undefined || body === null) {
    return;
  }

  const parsed = IssueGatewayTicketRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    throw createAppHttpError(
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
    throw createAppHttpError(
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
    throw createAppHttpError(400, "bad_request", "request body must be valid JSON");
  }
}

function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw createAppHttpError(400, "bad_request", "request body must be valid JSON");
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
