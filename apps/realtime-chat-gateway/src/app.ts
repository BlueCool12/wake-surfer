import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import type { ConsumeGatewayTicketResponse } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";

import type { RealtimeChatGatewayConfig } from "./config/env.js";
import type { AppLogger } from "./runtime/logger.js";

export type GatewayTicketConsumer = {
  consumeGatewayTicket: (request: {
    gatewayId: string;
    requestId: string;
    signal: AbortSignal;
    ticket: string;
  }) => Promise<ConsumeGatewayTicketResponse>;
};

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

type GatewaySession = {
  actorId: string;
  connectedAt: string;
  gatewayId: string;
  sessionId: string;
};

export function createRealtimeChatGatewayApp(
  config: RealtimeChatGatewayConfig,
  deps: RealtimeChatGatewayAppDeps,
): RealtimeChatGatewayApp {
  const sessions = new Map<WebSocket, GatewaySession>();
  const pendingAuthentications = new Set<WebSocket>();
  const awaitingPong = new Set<WebSocket>();
  let isDraining = false;
  let closePromise: Promise<void> | undefined;
  const websocketServer = new WebSocketServer({
    maxPayload: config.maxPayloadBytes,
    noServer: true,
    perMessageDeflate: false,
  });
  const httpServer = createServer(
    {
      headersTimeout: config.httpHeadersTimeoutMilliseconds,
      keepAliveTimeout: config.httpKeepAliveTimeoutMilliseconds,
      requestTimeout: config.httpRequestTimeoutMilliseconds,
    },
    (request, response) => {
      respondToHttpRequest(request, response, isDraining);
    },
  );

  httpServer.on("upgrade", (request, socket, head) => {
    if (isDraining) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    if (pathnameFromRequest(request) !== config.gatewayPath) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    if (!isAllowedOrigin(request, config.allowedOrigins)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    if (websocketServer.clients.size >= config.maxConnections) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (websocket, request) => {
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
    websocket.on("pong", () => {
      awaitingPong.delete(websocket);
    });
    websocket.once("close", (code, reason) => {
      awaitingPong.delete(websocket);
      pendingAuthentications.delete(websocket);
      sessions.delete(websocket);
      deps.logger.info(
        {
          closeCode: code,
          closeReason: reason.toString(),
          requestId,
        },
        "실시간 채팅 게이트웨이 연결 종료",
      );
    });

    if (pendingAuthentications.size >= config.maxPendingAuthentications) {
      websocket.close(1013, "인증 대기 연결이 많습니다");
      return;
    }

    pendingAuthentications.add(websocket);
    void attachGatewaySession(websocket, request, config, deps, sessions, requestId).finally(() => {
      pendingAuthentications.delete(websocket);
    });
  });

  websocketServer.on("error", (error) => {
    deps.logger.error({ error }, "실시간 채팅 게이트웨이 WebSocket 서버 오류");
  });

  const heartbeatTimer = setInterval(() => {
    for (const websocket of websocketServer.clients) {
      if (awaitingPong.has(websocket)) {
        deps.logger.warn({}, "heartbeat에 응답하지 않은 gateway 연결 종료");
        websocket.terminate();
        continue;
      }

      awaitingPong.add(websocket);
      websocket.ping();
    }
  }, config.heartbeatIntervalMilliseconds);
  heartbeatTimer.unref();

  return {
    address: () => httpServer.address(),
    close: () => {
      isDraining = true;
      closePromise ??= closeServers(
        websocketServer,
        httpServer,
        heartbeatTimer,
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
    pendingAuthenticationCount: () => pendingAuthentications.size,
    sessionCount: () => sessions.size,
  };
}

async function attachGatewaySession(
  websocket: WebSocket,
  request: IncomingMessage,
  config: RealtimeChatGatewayConfig,
  deps: RealtimeChatGatewayAppDeps,
  sessions: Map<WebSocket, GatewaySession>,
  requestId: string,
): Promise<void> {
  const ticket = extractTicket(request, config.ticketHeader);

  if (!ticket) {
    websocket.close(4401, "게이트웨이 티켓이 필요합니다");
    return;
  }

  let consumed: ConsumeGatewayTicketResponse;
  const abortController = new AbortController();
  const abortOnClose = (): void => {
    abortController.abort(new Error("게이트웨이 연결이 인증 전에 종료되었습니다"));
  };
  websocket.once("close", abortOnClose);
  const timeout = setTimeout(() => {
    abortController.abort(new Error("게이트웨이 티켓 소비 요청 시간 초과"));
  }, config.apiRequestTimeoutMilliseconds);
  timeout.unref();

  try {
    consumed = await raceWithAbort(
      deps.gatewayTicketConsumer.consumeGatewayTicket({
        gatewayId: config.gatewayId,
        requestId,
        signal: abortController.signal,
        ticket,
      }),
      abortController.signal,
    );
  } catch (error) {
    if (websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    deps.logger.warn(
      {
        error: serializeError(error),
        gatewayId: config.gatewayId,
        requestId,
      },
      "실시간 채팅 게이트웨이 티켓 소비 실패",
    );
    websocket.close(1011, "게이트웨이 티켓 서비스를 사용할 수 없습니다");
    return;
  } finally {
    clearTimeout(timeout);
    websocket.off("close", abortOnClose);
  }

  if (consumed.status === "rejected") {
    websocket.close(4401, consumed.reason);
    return;
  }

  if (websocket.readyState !== WebSocket.OPEN) {
    return;
  }

  sessions.set(websocket, {
    actorId: consumed.ticket.actorId,
    connectedAt: consumed.ticket.consumedAt,
    gatewayId: config.gatewayId,
    sessionId: requestId.replace("gateway-request_", "gateway-session_"),
  });
  deps.logger.info(
    {
      actorId: consumed.ticket.actorId,
      gatewayId: config.gatewayId,
      requestId,
    },
    "실시간 채팅 게이트웨이 연결 인증 완료",
  );
}

function respondToHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  isDraining: boolean,
): void {
  if (request.method === "GET" && pathnameFromRequest(request) === "/health") {
    writeJson(response, 200, {
      status: "ok",
    });
    return;
  }

  if (request.method === "GET" && pathnameFromRequest(request) === "/health/live") {
    writeJson(response, 200, {
      status: "ok",
    });
    return;
  }

  if (request.method === "GET" && pathnameFromRequest(request) === "/health/ready") {
    writeJson(response, isDraining ? 503 : 200, {
      status: isDraining ? "not_ready" : "ready",
    });
    return;
  }

  response.writeHead(404);
  response.end();
}

function isAllowedOrigin(request: IncomingMessage, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    return true;
  }

  const origin = request.headers.origin?.trim();
  return origin !== undefined && allowedOrigins.includes(origin);
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function extractTicket(request: IncomingMessage, ticketHeader: string): string | null {
  const queryTicket = new URL(request.url ?? "/", "ws://localhost").searchParams
    .get("ticket")
    ?.trim();

  if (queryTicket) {
    return queryTicket;
  }

  const header = request.headers[ticketHeader];
  const headerTicket = Array.isArray(header) ? header[0] : header;
  return headerTicket?.trim() || null;
}

function pathnameFromRequest(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
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

async function closeServers(
  websocketServer: WebSocketServer,
  httpServer: Server,
  heartbeatTimer: NodeJS.Timeout,
  shutdownGraceMilliseconds: number,
  logger: AppLogger,
): Promise<void> {
  clearInterval(heartbeatTimer);

  for (const client of websocketServer.clients) {
    client.close(1001, "서버가 종료 중입니다");
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
      new Promise<void>((resolve, reject) => {
        websocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    ]);

    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (failed) {
      throw failed.reason;
    }
  } finally {
    clearTimeout(forceCloseTimer);
  }
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
