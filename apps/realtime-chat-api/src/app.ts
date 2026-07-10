import { Hono } from "hono";

import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
  IssueGatewayTicketResponse,
  RealtimeChatErrorCode,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

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
  gatewayTicket: GatewayTicketService;
  logger: AppLogger;
};

type ErrorResponse = {
  code: RealtimeChatErrorCode;
  message: string;
  status: "error";
};

export class AppHttpError extends Error {
  readonly code: RealtimeChatErrorCode;
  readonly statusCode: 400 | 401 | 403;

  constructor(statusCode: 400 | 401 | 403, code: RealtimeChatErrorCode, message: string) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createRealtimeChatApiApp(deps: RealtimeChatApiAppDeps): Hono {
  const { authenticateActor, authenticateGateway, gatewayTicket, logger } = deps;
  const app = new Hono();

  app.get("/health", (context) => context.json({ status: "ok" as const }));

  app.post("/realtime-chat/gateway-tickets", async (context) => {
    const actor = await authenticateActor(context.req.raw);
    const issued = await gatewayTicket.issue({
      actorId: actor.actorId,
    });

    return context.json(issued, 201);
  });

  app.post("/internal/realtime-chat/gateway-tickets/consume", async (context) => {
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
    );

    return context.json(result);
  });

  app.notFound((context) =>
    context.json(
      {
        code: "bad_request",
        message: "route not found",
        status: "error",
      } satisfies ErrorResponse,
      404,
    ),
  );

  app.onError((error, context) => {
    if (error instanceof AppHttpError) {
      return context.json(
        {
          code: error.code,
          message: error.message,
          status: "error",
        } satisfies ErrorResponse,
        error.statusCode,
      );
    }

    logger.error(
      {
        error: serializeError(error),
        method: context.req.method,
        path: context.req.path,
        requestId: context.req.header("x-request-id") ?? null,
      },
      "realtime chat api request failed",
    );

    return context.json(
      {
        code: "gateway_ticket_unavailable",
        message: "gateway ticket service unavailable",
        status: "error",
      } satisfies ErrorResponse,
      500,
    );
  });

  return app;
}

async function readConsumeGatewayTicketRequest(
  request: Request,
): Promise<ConsumeGatewayTicketRequest> {
  const body = await readJsonObject(request);
  const keys = Object.keys(body);

  if (keys.length !== 1 || !Object.hasOwn(body, "ticket")) {
    throw new AppHttpError(400, "bad_request", "consume request body must contain only ticket");
  }

  if (typeof body.ticket !== "string") {
    throw new AppHttpError(400, "bad_request", "ticket must be a string");
  }

  return {
    ticket: body.ticket,
  };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new AppHttpError(400, "bad_request", "request body must be valid JSON");
  }

  if (!isRecord(body)) {
    throw new AppHttpError(400, "bad_request", "request body must be a JSON object");
  }

  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
