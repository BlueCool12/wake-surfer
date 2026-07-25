import type { Server } from "node:http";
import type { WebSocketServer } from "ws";

import type { AppLogger } from "./logger.js";

export async function closeServers(
  websocketServer: WebSocketServer,
  httpServer: Server,
  shutdownGraceMilliseconds: number,
  logger: AppLogger,
): Promise<void> {
  for (const client of websocketServer.clients) {
    client.close(1001, "server shutdown");
  }

  const forceCloseTimer = setTimeout(() => {
    logger.warn({}, "실시간 채팅 게이트웨이 종료 유예 시간 초과");

    for (const client of websocketServer.clients) {
      client.terminate();
    }

    httpServer.closeAllConnections();
  }, shutdownGraceMilliseconds);
  forceCloseTimer.unref();

  try {
    const results = await Promise.allSettled([
      closeWebSocketServer(websocketServer),
      closeHttpServer(httpServer),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (errors.length > 0) {
      throw new AggregateError(errors, "실시간 채팅 게이트웨이 서버 종료 실패");
    }
  } finally {
    clearTimeout(forceCloseTimer);
  }
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
