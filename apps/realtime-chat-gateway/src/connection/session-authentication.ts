import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";

import type { ConsumeGatewayTicketResponse } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type { GatewayTicketConsumer } from "../ports/gateway-ticket-consumer.js";

export type GatewaySession = {
  actorId: string;
  gatewayId: string;
  sessionId: string;
  ticketConsumedAt: string;
};

export type SessionAuthenticationOutcome =
  | {
      session: GatewaySession;
      status: "accepted";
    }
  | {
      code: 4401;
      reason: string;
      status: "rejected";
    }
  | {
      code: 1011;
      error: unknown;
      reason: string;
      status: "unavailable";
    }
  | {
      status: "abandoned";
    };

export type AuthenticateGatewaySessionInput = {
  apiRequestTimeoutMilliseconds: number;
  gatewayId: string;
  request: IncomingMessage;
  requestId: string;
  ticketConsumer: GatewayTicketConsumer;
  ticketHeader: string;
  websocket: WebSocket;
};

export async function authenticateGatewaySession(
  input: AuthenticateGatewaySessionInput,
): Promise<SessionAuthenticationOutcome> {
  const ticket = extractTicket(input.request, input.ticketHeader);

  if (!ticket) {
    return {
      code: 4401,
      reason: "게이트웨이 티켓이 필요합니다",
      status: "rejected",
    };
  }

  const abortController = new AbortController();
  const abortOnClose = (): void => {
    abortController.abort(new Error("게이트웨이 연결이 인증 전에 종료되었습니다"));
  };
  input.websocket.once("close", abortOnClose);
  const timeout = setTimeout(() => {
    abortController.abort(new Error("게이트웨이 티켓 소비 요청 시간 초과"));
  }, input.apiRequestTimeoutMilliseconds);
  timeout.unref();

  let consumed: ConsumeGatewayTicketResponse;

  try {
    consumed = await raceWithAbort(
      input.ticketConsumer.consumeGatewayTicket({
        gatewayId: input.gatewayId,
        requestId: input.requestId,
        signal: abortController.signal,
        ticket,
      }),
      abortController.signal,
    );
  } catch (error) {
    if (input.websocket.readyState !== WebSocket.OPEN) {
      return { status: "abandoned" };
    }

    return {
      code: 1011,
      error,
      reason: "게이트웨이 티켓 서비스를 사용할 수 없습니다",
      status: "unavailable",
    };
  } finally {
    clearTimeout(timeout);
    input.websocket.off("close", abortOnClose);
  }

  if (consumed.status === "rejected") {
    return {
      code: 4401,
      reason: consumed.reason,
      status: "rejected",
    };
  }

  if (input.websocket.readyState !== WebSocket.OPEN) {
    return { status: "abandoned" };
  }

  return {
    session: {
      actorId: consumed.ticket.actorId,
      gatewayId: input.gatewayId,
      sessionId: input.requestId.replace("gateway-request_", "gateway-session_"),
      ticketConsumedAt: consumed.ticket.consumedAt,
    },
    status: "accepted",
  };
}

function extractTicket(request: IncomingMessage, ticketHeader: string): string | null {
  let queryTicket: string | undefined;

  try {
    queryTicket = new URL(request.url ?? "/", "ws://localhost").searchParams.get("ticket")?.trim();
  } catch {
    return null;
  }

  if (queryTicket) {
    return queryTicket;
  }

  const header = request.headers[ticketHeader];
  const headerTicket = Array.isArray(header) ? header[0] : header;
  return headerTicket?.trim() || null;
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });

    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
