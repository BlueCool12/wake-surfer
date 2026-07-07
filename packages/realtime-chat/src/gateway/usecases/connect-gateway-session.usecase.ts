import type {
  GatewayId,
  GatewaySessionId,
  GatewayTicket,
  RealtimeChatErrorCode,
} from "@wake-surfer/realtime-chat-contracts";
import type { GatewayTicketConsumeResult } from "../runtime-deps";
import type { GatewaySession } from "../session/gateway-session";
import type { WebSocketConnectionLike } from "../websocket/websocket-server-like";

export type ConnectGatewaySessionResult =
  | {
      status: "connected";
      session: GatewaySession;
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };

type ConnectGatewaySessionCommand = {
  ticketValue: GatewayTicket;
  connection: WebSocketConnectionLike;
};

export type ConnectGatewaySessionUsecaseDeps = {
  gatewayId: GatewayId;
  consumeGatewayTicket: (input: {
    ticketValue: GatewayTicket;
    gatewayId: GatewayId;
  }) => Promise<GatewayTicketConsumeResult>;
  now: () => Date;
  generateGatewaySessionId: () => GatewaySessionId;
  registerGatewaySession: (session: GatewaySession) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  incrementMetric?: (name: string, tags?: Record<string, string>) => void;
};

export async function connectGatewaySession(
  command: ConnectGatewaySessionCommand,
  deps: ConnectGatewaySessionUsecaseDeps,
): Promise<ConnectGatewaySessionResult> {
  const consumeResult = await consumeGatewayTicket(command.ticketValue, deps);

  if (consumeResult.status === "rejected") {
    return {
      status: "rejected",
      reason: consumeResult.reason,
      ...(consumeResult.message ? { message: consumeResult.message } : {}),
    };
  }

  const session: GatewaySession = {
    sessionId: deps.generateGatewaySessionId(),
    userId: consumeResult.ticket.actorId,
    gatewayId: deps.gatewayId,
    connectedAt: deps.now().toISOString(),
    connection: command.connection,
  };

  deps.registerGatewaySession(session);
  deps.incrementMetric?.("realtime_chat.gateway.session_connected");

  return {
    status: "connected",
    session,
  };
}

async function consumeGatewayTicket(
  ticketValue: GatewayTicket,
  deps: ConnectGatewaySessionUsecaseDeps,
): Promise<GatewayTicketConsumeResult> {
  try {
    return await deps.consumeGatewayTicket({
      ticketValue,
      gatewayId: deps.gatewayId,
    });
  } catch (error) {
    deps.warn("failed to consume realtime chat gateway ticket", {
      error,
      gatewayId: deps.gatewayId,
    });

    return {
      status: "rejected",
      reason: "API_UNAVAILABLE",
    };
  }
}
