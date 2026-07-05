import type { RealtimeChatErrorCode } from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatGatewayRuntimeDeps } from "../runtime-deps";
import { connectGatewaySession } from "../application/connect-gateway-session.usecase";
import { closeGatewaySession } from "../application/close-gateway-session.usecase";
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
    const ticket = extractTicket(connection);

    if (!ticket) {
      await rejectConnection(connection, "GATEWAY_TICKET_MISSING");
      return;
    }

    const connectResult = await connectGatewaySession(
      ticket,
      connection,
      sessionRegistry,
      options,
      deps,
    );

    if (connectResult.status === "rejected") {
      await rejectConnection(connection, connectResult.reason, connectResult.message);
      return;
    }

    const session = connectResult.session;
    await sendSocketEvent(connection, {
      type: "gateway.connected",
      sessionId: session.sessionId,
      gatewayId: session.gatewayId,
      connectedAt: session.connectedAt,
    });

    connection.onMessage((payload) =>
      handleSocketMessage(payload, session, sessionRegistry, options, deps),
    );
    connection.onClose(() => closeGatewaySession(session.sessionId, sessionRegistry, deps));
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
