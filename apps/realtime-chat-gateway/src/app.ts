import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import {
  GatewayConnectedEventSchema,
  GatewayNotReadyEventSchema,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import {
  parseSendMessageRequest,
  type SendMessageRequest,
  type SendMessageResponse,
} from "@wake-surfer/realtime-chat-message-send-contracts";
import {
  registerGatewayStreamMessagesRelay,
  type GatewayStreamMessagesApiClient,
  type GatewayStreamMessagesRuntime,
  type GatewayStreamMessagesSession,
} from "@wake-surfer/realtime-chat-stream-messages-gateway";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { evaluateUpgrade } from "./connection/upgrade-policy.js";
import type { RealtimeChatGatewayConfig } from "./config/env.js";
import { respondToHttpRequest } from "./http/health.js";
import {
  isRecord,
  parseRawPayload,
  parseWireFrame,
  serializeWireFrame,
} from "./protocol/wire-frame.js";
import { closeServers } from "./runtime/close-servers.js";

import type { GatewayApiClient } from "./runtime/gateway-api-client.js";
import type { AppLogger } from "./runtime/logger.js";

type LocalGatewaySession = GatewayStreamMessagesSession & {
  abortController: AbortController;
  channels: Set<string>;
  socket: WebSocket;
};

type StreamSyncListener = Parameters<GatewayStreamMessagesRuntime["onStreamSync"]>[0];
type SessionClosedListener = Parameters<GatewayStreamMessagesRuntime["onSessionClosed"]>[0];

export type RealtimeChatGatewayAppDeps = {
  gatewayApiClient: GatewayApiClient;
  logger: AppLogger;
  streamMessagesApiClient: GatewayStreamMessagesApiClient;
  createId?: () => string;
  now?: () => Date;
};

export type RealtimeChatGatewayApp = {
  address: () => AddressInfo | string | null;
  close: () => Promise<void>;
  listen: (options?: { host?: string; port?: number }) => Promise<void>;
  sessionCount: () => number;
};

export function createRealtimeChatGatewayApp(
  config: RealtimeChatGatewayConfig,
  deps: RealtimeChatGatewayAppDeps,
): RealtimeChatGatewayApp {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? (() => new Date());
  const sessionsById = new Map<string, LocalGatewaySession>();
  const sessionsBySocket = new Map<WebSocket, LocalGatewaySession>();
  const streamSyncListeners = new Set<StreamSyncListener>();
  const sessionClosedListeners = new Set<SessionClosedListener>();
  const messageSendAbortController = new AbortController();
  let isClosing = false;
  let closePromise: Promise<void> | undefined;

  const websocketServer = new WebSocketServer({
    maxPayload: config.maxPayloadBytes,
    noServer: true,
    perMessageDeflate: false,
  });
  const httpServer = createServer((request, response) => {
    respondToHttpRequest(request, response, isClosing);
  });
  const streamMessagesRuntime: GatewayStreamMessagesRuntime = {
    closeSession: (sessionId, connectionGeneration, code) => {
      const session = getCurrentSession(sessionId, connectionGeneration);
      session?.socket.close(code, "invalid stream sync frame");
    },
    onSessionClosed: (listener) => {
      sessionClosedListeners.add(listener);
      return () => {
        sessionClosedListeners.delete(listener);
      };
    },
    onStreamSync: (listener) => {
      streamSyncListeners.add(listener);
      return () => {
        streamSyncListeners.delete(listener);
      };
    },
    send: async (sessionId, connectionGeneration, eventName, rawPayload) => {
      const session = getCurrentSession(sessionId, connectionGeneration);

      if (session === undefined) {
        return;
      }

      await sendWireEvent(session.socket, eventName, parseRawPayload(rawPayload));
    },
  };
  const unregisterStreamMessagesRelay = registerGatewayStreamMessagesRelay({
    apiClient: deps.streamMessagesApiClient,
    getSession: (sessionId) => sessionsById.get(sessionId),
    logger: deps.logger,
    runtime: streamMessagesRuntime,
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const rejection = evaluateUpgrade(request, {
      allowedOrigins: config.allowedOrigins,
      gatewayPath: config.gatewayPath,
      isClosing,
    });

    if (rejection !== null) {
      rejectUpgrade(socket, rejection.status, rejection.reason);
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (websocket, request) => {
    websocket.on("error", (error) => {
      deps.logger.warn({ error: serializeError(error) }, "실시간 채팅 WebSocket 오류");
    });
    websocket.on("message", (data, isBinary) => {
      void handleSocketMessage(websocket, data, isBinary).catch((error: unknown) => {
        deps.logger.error(
          { error: serializeError(error) },
          "실시간 채팅 WebSocket frame 처리 실패",
        );
        closeIfOpen(websocket, 1011, "frame handling failed");
      });
    });
    websocket.once("close", () => {
      const session = sessionsBySocket.get(websocket);

      if (session !== undefined) {
        removeSession(session);
      }
    });

    void authenticateConnection(websocket, request.url).catch((error: unknown) => {
      deps.logger.warn({ error: serializeError(error) }, "실시간 채팅 게이트웨이 티켓 인증 실패");
      closeIfOpen(websocket, 1011, "ticket service unavailable");
    });
  });

  websocketServer.on("error", (error) => {
    deps.logger.error({ error: serializeError(error) }, "실시간 채팅 WebSocket 서버 오류");
  });

  function getCurrentSession(
    sessionId: string,
    connectionGeneration: string,
  ): LocalGatewaySession | undefined {
    const session = sessionsById.get(sessionId);
    return session?.connectionGeneration === connectionGeneration ? session : undefined;
  }

  async function authenticateConnection(websocket: WebSocket, requestUrl: string | undefined) {
    const ticket = extractTicket(requestUrl);

    if (ticket === null) {
      closeIfOpen(websocket, 4401, "gateway ticket required");
      return;
    }

    const abortController = new AbortController();
    const abortOnClose = (): void => {
      abortController.abort(new Error("WebSocket closed before authentication completed"));
    };
    websocket.once("close", abortOnClose);

    let consumed: Awaited<ReturnType<GatewayApiClient["consumeGatewayTicket"]>>;

    try {
      consumed = await deps.gatewayApiClient.consumeGatewayTicket({
        requestId: `gateway-request_${createId()}`,
        signal: abortController.signal,
        ticket,
      });
    } finally {
      websocket.off("close", abortOnClose);
    }

    if (consumed.status === "rejected") {
      closeIfOpen(websocket, 4401, "gateway ticket rejected");
      return;
    }

    if (websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const session: LocalGatewaySession = {
      abortController: new AbortController(),
      actorId: consumed.ticket.actorId,
      channels: new Set(),
      connectedEventSent: false,
      connectionGeneration: `gateway-connection_${createId()}`,
      sessionId: `gateway-session_${createId()}`,
      socket: websocket,
      state: "authenticating",
    };
    sessionsById.set(session.sessionId, session);
    sessionsBySocket.set(websocket, session);

    try {
      const connectedEvent = GatewayConnectedEventSchema.parse({
        protocolVersion: 1,
        connectionGeneration: session.connectionGeneration,
        gatewayId: config.gatewayId,
        sessionId: session.sessionId,
        connectedAt: now().toISOString(),
      });
      await sendWireEvent(websocket, "gateway.connected", connectedEvent);
      session.connectedEventSent = true;
      session.state = "ready";
      deps.logger.info(
        {
          actorId: session.actorId,
          connectionGeneration: session.connectionGeneration,
          sessionId: session.sessionId,
        },
        "실시간 채팅 게이트웨이 연결 인증 완료",
      );
    } catch (error) {
      removeSession(session);
      throw error;
    }
  }

  async function handleSocketMessage(
    websocket: WebSocket,
    data: RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      closeIfOpen(websocket, 1003, "binary frames are not supported");
      return;
    }

    const frame = parseWireFrame(data.toString());

    if (frame === null) {
      closeIfOpen(websocket, 1008, "invalid event frame");
      return;
    }

    const session = sessionsBySocket.get(websocket);

    if (session === undefined || session.state !== "ready" || session.connectedEventSent !== true) {
      await sendWireEvent(
        websocket,
        "gateway.not_ready",
        GatewayNotReadyEventSchema.parse({ code: "gateway.not_ready" }),
      );
      return;
    }

    switch (frame.type) {
      case "chat.channel.join": {
        const channelId = readJoinedChannelId(frame.payload);

        if (channelId === null) {
          closeIfOpen(websocket, 1008, "invalid channel join frame");
          return;
        }

        session.channels.add(channelId);
        return;
      }
      case "chat.message.send": {
        const parsed = parseSendMessageRequest(frame.payload);

        if (!parsed.ok) {
          closeIfOpen(websocket, 1008, "invalid message send frame");
          return;
        }

        await relayMessageSend(session, parsed.value);
        return;
      }
      case "chat.stream.sync": {
        await Promise.all(
          [...streamSyncListeners].map((listener) =>
            listener({
              sessionId: session.sessionId,
              connectionGeneration: session.connectionGeneration,
              rawFrame: JSON.stringify(frame.payload),
            }),
          ),
        );
        return;
      }
      default:
        closeIfOpen(websocket, 1008, "unsupported event type");
    }
  }

  async function relayMessageSend(
    session: LocalGatewaySession,
    request: SendMessageRequest,
  ): Promise<void> {
    if (request.target.type !== "channel" || !session.channels.has(request.target.channelId)) {
      const rejected: Extract<SendMessageResponse, { status: "rejected" }> = {
        status: "rejected",
        idempotencyKey: request.idempotencyKey,
        reason: "write_forbidden",
      };
      await sendWireEvent(session.socket, "chat.message.rejected", { ...rejected });
      return;
    }

    const response = await deps.gatewayApiClient.sendMessage(request, {
      actorId: session.actorId,
      requestId: `gateway-request_${createId()}`,
      signal: messageSendAbortController.signal,
    });

    if (response.status === "rejected") {
      await sendWireEvent(session.socket, "chat.message.rejected", { ...response });
      return;
    }

    if (
      response.message.target.type !== "channel" ||
      response.message.target.channelId !== request.target.channelId
    ) {
      throw new Error("메시지 전송 API가 요청과 다른 channel message를 반환했습니다.");
    }

    const channelId = response.message.target.channelId;
    const { text, ...createdMessage } = response.message;
    const { persistence, ...acceptedResponse } = response;
    const acceptedDelivery = sendWireEvent(session.socket, "chat.message.accepted", {
      ...acceptedResponse,
    }).catch((error: unknown) => {
      deps.logger.warn(
        {
          error: serializeError(error),
          sessionId: session.sessionId,
        },
        "실시간 채팅 메시지 accepted 전달 실패",
      );
    });

    if (persistence === "existing") {
      await acceptedDelivery;
      return;
    }

    const deliveries = [...sessionsById.values()]
      .filter(
        (candidate) =>
          candidate.state === "ready" &&
          candidate.connectedEventSent &&
          candidate.channels.has(channelId),
      )
      .map(async (candidate) => {
        try {
          await sendWireEvent(candidate.socket, "chat.message.created", {
            ...createdMessage,
            content: { type: "text", text },
          });
        } catch (error) {
          deps.logger.warn(
            {
              error: serializeError(error),
              sessionId: candidate.sessionId,
            },
            "실시간 채팅 메시지 fan-out 실패",
          );
        }
      });
    await Promise.all([acceptedDelivery, ...deliveries]);
  }

  function removeSession(session: LocalGatewaySession): void {
    if (sessionsById.get(session.sessionId) !== session) {
      return;
    }

    session.state = "closed";
    session.abortController.abort(new Error("Gateway session closed"));
    sessionsById.delete(session.sessionId);
    sessionsBySocket.delete(session.socket);

    for (const listener of sessionClosedListeners) {
      listener({
        sessionId: session.sessionId,
        connectionGeneration: session.connectionGeneration,
      });
    }
  }

  return {
    address: () => httpServer.address(),
    close: () => {
      isClosing = true;
      closePromise ??= (async () => {
        messageSendAbortController.abort(new Error("Gateway is shutting down"));
        unregisterStreamMessagesRelay();
        await closeServers(
          websocketServer,
          httpServer,
          config.shutdownGraceMilliseconds,
          deps.logger,
        );
      })();
      return closePromise;
    },
    listen: (options) =>
      listen(httpServer, {
        host: options?.host ?? config.host,
        port: options?.port ?? config.port,
      }),
    sessionCount: () => sessionsById.size,
  };
}

function readJoinedChannelId(payload: Record<string, unknown>): string | null {
  if (
    Object.keys(payload).length !== 1 ||
    typeof payload.channelId !== "string" ||
    payload.channelId.trim().length === 0 ||
    payload.channelId.trim() !== payload.channelId
  ) {
    return null;
  }

  return payload.channelId;
}

function extractTicket(requestUrl: string | undefined): string | null {
  try {
    const ticket = new URL(requestUrl ?? "/", "ws://localhost").searchParams.get("ticket")?.trim();
    return ticket || null;
  } catch {
    return null;
  }
}

async function sendWireEvent(
  websocket: WebSocket,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (websocket.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket이 열려 있지 않습니다.");
  }

  const serialized = serializeWireFrame(type, payload);

  await new Promise<void>((resolve, reject) => {
    websocket.send(serialized, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function closeIfOpen(websocket: WebSocket, code: number, reason: string): void {
  if (websocket.readyState === WebSocket.OPEN) {
    websocket.close(code, reason);
  }
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

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (isRecord(error)) {
    return error;
  }

  return { value: String(error) };
}
