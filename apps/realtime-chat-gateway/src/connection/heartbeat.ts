import { WebSocket } from "ws";

import type { AppLogger } from "../runtime/logger.js";

export type GatewayHeartbeat = {
  close: () => void;
  forget: (websocket: WebSocket) => void;
  markAlive: (websocket: WebSocket) => void;
};

export function createGatewayHeartbeat(
  clients: Set<WebSocket>,
  intervalMilliseconds: number,
  logger: AppLogger,
): GatewayHeartbeat {
  const awaitingPong = new Set<WebSocket>();
  const timer = setInterval(() => {
    for (const websocket of clients) {
      if (awaitingPong.has(websocket)) {
        logger.warn({}, "heartbeat에 응답하지 않은 gateway 연결 종료");
        websocket.terminate();
        continue;
      }

      if (websocket.readyState !== WebSocket.OPEN) {
        awaitingPong.delete(websocket);
        continue;
      }

      try {
        awaitingPong.add(websocket);
        websocket.ping();
      } catch (error) {
        awaitingPong.delete(websocket);
        logger.warn({ error }, "gateway heartbeat 전송 실패");
        websocket.terminate();
      }
    }
  }, intervalMilliseconds);
  timer.unref();

  return {
    close: () => clearInterval(timer),
    forget: (websocket) => awaitingPong.delete(websocket),
    markAlive: (websocket) => awaitingPong.delete(websocket),
  };
}
