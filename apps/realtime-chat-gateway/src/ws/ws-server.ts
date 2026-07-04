import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  LoggerPort,
  WebSocketConnectionLike,
  WebSocketMessagePayload,
  WebSocketRouteDefinition,
  WebSocketServerLike
} from '@wake-surfer/realtime-chat/gateway';

export type NodeRealtimeChatGatewayServer = {
  httpServer: Server;
  wsServer: WebSocketServerLike;
  listen: (options: { host: string; port: number }) => Promise<void>;
  address: () => AddressInfo | string | null;
  close: () => Promise<void>;
};

export function createNodeRealtimeChatGatewayServer(
  logger: LoggerPort
): NodeRealtimeChatGatewayServer {
  const routes = new Map<string, WebSocketRouteDefinition>();
  const socketServer = new WebSocketServer({ noServer: true });
  const httpServer = createServer((request, response) => {
    respondToHealthRequest(request, response);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const route = routes.get(pathnameFromRequest(request));

    if (!route) {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (socketConnection) => {
      Promise.resolve(
        route.onConnection(toConnectionLike(socketConnection, request, logger))
      ).catch((error: unknown) => {
          logger.error('failed to handle realtime chat websocket connection', {
            error
          });
          socketConnection.close(1011, 'INTERNAL_ERROR');
        });
    });
  });

  socketServer.on('error', (error) => {
    logger.error('realtime chat websocket server error', { error });
  });

  return {
    httpServer,
    wsServer: {
      route(definition) {
        routes.set(definition.path, definition);
      }
    },
    listen({ host, port }) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve();
        });
      });
    },
    address() {
      return httpServer.address();
    },
    close() {
      return new Promise((resolve, reject) => {
        socketServer.close((socketError) => {
          if (socketError) {
            reject(socketError);
            return;
          }

          httpServer.close((serverError) => {
            if (serverError) {
              reject(serverError);
              return;
            }

            resolve();
          });
        });
      });
    }
  };
}

function respondToHealthRequest(
  request: IncomingMessage,
  response: ServerResponse
): void {
  if (request.method !== 'GET') {
    response.writeHead(404);
    response.end();
    return;
  }

  const pathname = pathnameFromRequest(request);

  if (pathname === '/healthz') {
    writeJson(response, 200, {
      status: 'ok',
      service: '@wake-surfer/realtime-chat-gateway'
    });
    return;
  }

  if (pathname === '/readyz') {
    writeJson(response, 200, {
      status: 'ready',
      database: 'configured'
    });
    return;
  }

  response.writeHead(404);
  response.end();
}

function toConnectionLike(
  socket: WebSocket,
  request: IncomingMessage,
  logger: LoggerPort
): WebSocketConnectionLike {
  return {
    query: queryFromRequest(request),
    headers: headersFromRequest(request),
    send(payload) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      return new Promise<void>((resolve, reject) => {
        socket.send(payload, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    onMessage(handler) {
      socket.on('message', (data) => {
        Promise.resolve(handler(toMessagePayload(data))).catch(
          (error: unknown) => {
            logger.error('failed to handle realtime chat websocket message', {
              error
            });
          }
        );
      });
    },
    onClose(handler) {
      socket.on('close', () => {
        Promise.resolve(handler()).catch((error: unknown) => {
          logger.error('failed to close realtime chat websocket session', {
            error
          });
        });
      });
    }
  };
}

function toMessagePayload(data: RawData): WebSocketMessagePayload {
  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  return data;
}

function queryFromRequest(
  request: IncomingMessage
): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  const url = new URL(request.url ?? '/', 'ws://localhost');

  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value;
  }

  return query;
}

function headersFromRequest(
  request: IncomingMessage
): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(request.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value)
      ? value.join(', ')
      : value;
  }

  return headers;
}

function pathnameFromRequest(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://localhost').pathname;
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}
