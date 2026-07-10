import { Hono } from "hono";

import type { ApiErrorResponse } from "@wake-surfer/api-contracts";
import {
  parseConsumeGatewayTicketRequestBody,
  parseIssueGatewayTicketRequestBody,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
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

type GatewayTicketErrorResponse = ApiErrorResponse<RealtimeChatErrorCode>;

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
    await readIssueGatewayTicketRequest(context.req.raw);

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
      } satisfies GatewayTicketErrorResponse,
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
        } satisfies GatewayTicketErrorResponse,
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
      } satisfies GatewayTicketErrorResponse,
      500,
    );
  });

  return app;
}

async function readIssueGatewayTicketRequest(request: Request): Promise<void> {
  const body = await readOptionalJsonBody(request);
  const parsed = parseIssueGatewayTicketRequestBody(body);

  if (!parsed.ok) {
    throw new AppHttpError(400, "bad_request", parsed.message);
  }
}

async function readConsumeGatewayTicketRequest(
  request: Request,
): Promise<ConsumeGatewayTicketRequest> {
  const body = await readRequiredJsonBody(request);
  const parsed = parseConsumeGatewayTicketRequestBody(body);

  if (!parsed.ok) {
    throw new AppHttpError(400, "bad_request", parsed.message);
  }

  return parsed.value;
}

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  if (request.body === null) {
    return undefined;
  }

  return readRequiredJsonBody(request);
}

async function readRequiredJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
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
