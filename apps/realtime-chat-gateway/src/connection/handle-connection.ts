import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";

import type { RealtimeChatGatewayConfig } from "../config/env.js";
import type { AppLogger } from "../runtime/logger.js";
import type { GatewayHeartbeat } from "./heartbeat.js";
import {
  authenticateGatewaySession,
  type GatewaySession,
  type SessionAuthenticationOutcome,
} from "./session-authentication.js";
import type { GatewayTicketConsumer } from "../ports/gateway-ticket-consumer.js";

export type GatewayConnectionState = {
  pendingAuthentications: Set<WebSocket>;
  sessions: Map<WebSocket, GatewaySession>;
};

export type GatewayConnectionHandlerDeps = {
  config: RealtimeChatGatewayConfig;
  heartbeat: GatewayHeartbeat;
  logger: AppLogger;
  state: GatewayConnectionState;
  ticketConsumer: GatewayTicketConsumer;
};

export function createGatewayConnectionHandler(
  deps: GatewayConnectionHandlerDeps,
): (websocket: WebSocket, request: IncomingMessage) => void {
  return (websocket, request) => {
    const requestId = `gateway-request_${randomUUID()}`;

    websocket.on("error", (error) => {
      deps.logger.warn(
        {
          error: serializeError(error),
          requestId,
        },
        "실시간 채팅 게이트웨이 소켓 오류",
      );
    });
    websocket.on("pong", () => deps.heartbeat.markAlive(websocket));
    websocket.once("close", (code, reason) => {
      deps.heartbeat.forget(websocket);
      deps.state.pendingAuthentications.delete(websocket);
      deps.state.sessions.delete(websocket);
      deps.logger.info(
        {
          closeCode: code,
          closeReason: reason.toString(),
          requestId,
        },
        "실시간 채팅 게이트웨이 연결 종료",
      );
    });

    if (deps.state.pendingAuthentications.size >= deps.config.maxPendingAuthentications) {
      websocket.close(1013, "인증 대기 연결이 많습니다");
      return;
    }

    deps.state.pendingAuthentications.add(websocket);
    void authenticateGatewaySession({
      apiRequestTimeoutMilliseconds: deps.config.apiRequestTimeoutMilliseconds,
      gatewayId: deps.config.gatewayId,
      request,
      requestId,
      ticketConsumer: deps.ticketConsumer,
      ticketHeader: deps.config.ticketHeader,
      websocket,
    })
      .then((outcome) => applyAuthenticationOutcome(websocket, outcome, requestId, deps))
      .catch((error: unknown) => {
        deps.logger.error(
          {
            error: serializeError(error),
            gatewayId: deps.config.gatewayId,
            requestId,
          },
          "실시간 채팅 게이트웨이 연결 인증 처리 실패",
        );
        closeIfOpen(websocket, 1011, "게이트웨이 티켓 서비스를 사용할 수 없습니다");
      })
      .finally(() => {
        deps.state.pendingAuthentications.delete(websocket);
      });
  };
}

function applyAuthenticationOutcome(
  websocket: WebSocket,
  outcome: SessionAuthenticationOutcome,
  requestId: string,
  deps: GatewayConnectionHandlerDeps,
): void {
  switch (outcome.status) {
    case "accepted":
      deps.state.sessions.set(websocket, outcome.session);
      deps.logger.info(
        {
          actorId: outcome.session.actorId,
          gatewayId: outcome.session.gatewayId,
          requestId,
        },
        "실시간 채팅 게이트웨이 연결 인증 완료",
      );
      return;
    case "rejected":
      closeIfOpen(websocket, outcome.code, outcome.reason);
      return;
    case "unavailable":
      deps.logger.warn(
        {
          error: serializeError(outcome.error),
          gatewayId: deps.config.gatewayId,
          requestId,
        },
        "실시간 채팅 게이트웨이 티켓 소비 실패",
      );
      closeIfOpen(websocket, outcome.code, outcome.reason);
      return;
    case "abandoned":
      return;
  }
}

function closeIfOpen(websocket: WebSocket, code: number, reason: string): void {
  if (websocket.readyState === WebSocket.OPEN) {
    websocket.close(code, reason);
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
