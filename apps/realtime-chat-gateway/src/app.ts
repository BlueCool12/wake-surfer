import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { createGatewayConnectionHandler } from "./connection/handle-connection.js";
import { createGatewayHeartbeat } from "./connection/heartbeat.js";
import type { GatewaySession } from "./connection/session-authentication.js";
import { evaluateUpgrade } from "./connection/upgrade-policy.js";
import type { RealtimeChatGatewayConfig } from "./config/env.js";
import { respondToHttpRequest } from "./http/health.js";
import type { GatewayTicketConsumer } from "./ports/gateway-ticket-consumer.js";
import { closeServers } from "./runtime/close-servers.js";
import type { AppLogger } from "./runtime/logger.js";

export type { GatewayTicketConsumer } from "./ports/gateway-ticket-consumer.js";

export type RealtimeChatGatewayAppDeps = {
  gatewayTicketConsumer: GatewayTicketConsumer;
  logger: AppLogger;
};

export type RealtimeChatGatewayApp = {
  address: () => AddressInfo | string | null;
  close: () => Promise<void>;
  listen: (options?: { host?: string; port?: number }) => Promise<void>;
  pendingAuthenticationCount: () => number;
  sessionCount: () => number;
};

export function createRealtimeChatGatewayApp(
  config: RealtimeChatGatewayConfig,
  deps: RealtimeChatGatewayAppDeps,
): RealtimeChatGatewayApp {
  const state = {
    sessions: new Map<WebSocket, GatewaySession>(),
    pendingAuthentications: new Set<WebSocket>(),
  };
  let isDraining = false;
  let closePromise: Promise<void> | undefined;
  const websocketServer = new WebSocketServer({
    maxPayload: config.maxPayloadBytes,
    noServer: true,
    perMessageDeflate: false,
  });
  const heartbeat = createGatewayHeartbeat(
    websocketServer.clients,
    config.heartbeatIntervalMilliseconds,
    deps.logger,
  );
  const httpServer = createServer(
    {
      headersTimeout: config.httpHeadersTimeoutMilliseconds,
      keepAliveTimeout: config.httpKeepAliveTimeoutMilliseconds,
      requestTimeout: config.httpRequestTimeoutMilliseconds,
    },
    (request, response) => respondToHttpRequest(request, response, isDraining),
  );

  httpServer.on("upgrade", (request, socket, head) => {
    const rejection = evaluateUpgrade(request, {
      allowedOrigins: config.allowedOrigins,
      clientCount: websocketServer.clients.size,
      gatewayPath: config.gatewayPath,
      isDraining,
      maxConnections: config.maxConnections,
    });

    if (rejection) {
      rejectUpgrade(socket, rejection.status, rejection.reason);
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  websocketServer.on(
    "connection",
    createGatewayConnectionHandler({
      config,
      heartbeat,
      logger: deps.logger,
      state,
      ticketConsumer: deps.gatewayTicketConsumer,
    }),
  );
  websocketServer.on("error", (error) => {
    deps.logger.error({ error }, "실시간 채팅 게이트웨이 WebSocket 서버 오류");
  });

  return {
    address: () => httpServer.address(),
    close: () => {
      isDraining = true;
      closePromise ??= closeServers(
        websocketServer,
        httpServer,
        heartbeat.close,
        config.shutdownGraceMilliseconds,
        deps.logger,
      );
      return closePromise;
    },
    listen: (options) =>
      listen(httpServer, {
        host: options?.host ?? config.host,
        port: options?.port ?? config.port,
      }),
    pendingAuthenticationCount: () => state.pendingAuthentications.size,
    sessionCount: () => state.sessions.size,
  };
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function listen(server: Server, options: { host: string; port: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
