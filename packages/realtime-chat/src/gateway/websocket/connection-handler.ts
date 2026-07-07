import type { GatewaySessionId, RealtimeChatErrorCode } from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatGatewayRuntimeDeps } from "../runtime-deps";
import { connectGatewaySession } from "../usecases/connect-gateway-session.usecase";
import { closeGatewaySession } from "../usecases/close-gateway-session.usecase";
import type { InMemoryGatewaySessionRegistry } from "../session/in-memory-gateway-session-registry";
import type { RealtimeChatGatewayMountOptions } from "./mount";
import type { WebSocketConnectionLike } from "./websocket-server-like";
import { sendSocketEvent } from "./send-socket-event";
import { handleSocketMessage } from "./message-handler";

export function createConnectionHandler(
  sessionRegistry: InMemoryGatewaySessionRegistry,
  options: RealtimeChatGatewayMountOptions,
  deps: RealtimeChatGatewayRuntimeDeps,
): (connection: WebSocketConnectionLike) => Promise<void> {
  return async (connection) => {
    const connectedSession: { sessionId?: GatewaySessionId } = {};
    let connectionClosed = false;

    connection.onClose(() => {
      connectionClosed = true;

      if (connectedSession.sessionId) {
        closeGatewaySession(connectedSession.sessionId, sessionRegistry, deps);
      }
    });

    const ticket = extractTicket(connection);

    if (!ticket) {
      await rejectConnection(connection, "GATEWAY_TICKET_MISSING");
      return;
    }

    const connectResult = await connectGatewaySession(
      {
        ticketValue: ticket,
        connection,
      },
      {
        gatewayId: options.gatewayId,
        consumeGatewayTicket: (input) => deps.gatewayTicketPort.consume(input),
        now: () => deps.clock.now(),
        generateGatewaySessionId: () => deps.idGenerator.generateId("gateway-session"),
        registerGatewaySession: (session) => sessionRegistry.register(session),
        warn: (message, fields) => deps.logger.warn(message, fields),
        ...(deps.metrics
          ? {
              incrementMetric: (name, tags) => deps.metrics?.increment(name, tags),
            }
          : {}),
      },
    );

    if (connectResult.status === "rejected") {
      await rejectConnection(connection, connectResult.reason, connectResult.message);
      return;
    }

    const session = connectResult.session;
    connectedSession.sessionId = session.sessionId;

    if (connectionClosed) {
      closeGatewaySession(session.sessionId, sessionRegistry, deps);
      return;
    }

    try {
      await sendSocketEvent(connection, {
        type: "gateway.connected",
        sessionId: session.sessionId,
        gatewayId: session.gatewayId,
        connectedAt: session.connectedAt,
      });
    } catch (error) {
      closeGatewaySession(session.sessionId, sessionRegistry, deps);
      deps.logger.warn("failed to send realtime chat gateway connected event", {
        error,
        sessionId: session.sessionId,
      });
      return;
    }

    connection.onMessage((payload) =>
      handleSocketMessage(payload, session, sessionRegistry, options, deps),
    );
  };
}

function extractTicket(connection: WebSocketConnectionLike): string | undefined {
  const queryTicket = connection.query["ticket"];

  if (queryTicket && queryTicket.trim() !== "") {
    return queryTicket.trim();
  }

  const headerTicket = connection.headers["x-gateway-ticket"];
  return headerTicket && headerTicket.trim() !== "" ? headerTicket.trim() : undefined;
}

async function rejectConnection(
  connection: WebSocketConnectionLike,
  reason: RealtimeChatErrorCode,
  message?: string,
): Promise<void> {
  await sendSocketEvent(connection, {
    type: "gateway.connection.rejected",
    reason,
    ...(message ? { message } : {}),
  });
  await connection.close(4401, reason);
}
