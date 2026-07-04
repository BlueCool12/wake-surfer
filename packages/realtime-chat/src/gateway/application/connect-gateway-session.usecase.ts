import type { RealtimeChatErrorCode } from '@wake-surfer/realtime-chat-contracts';
import type { RealtimeChatGatewayRuntimeDeps } from '../runtime-deps';
import type { GatewaySession } from '../session/gateway-session';
import type { InMemoryGatewaySessionRegistry } from '../session/in-memory-gateway-session-registry';
import type { RealtimeChatGatewayMountOptions } from '../websocket/mount';
import type { WebSocketConnectionLike } from '../websocket/websocket-server-like';

export type ConnectGatewaySessionResult =
  | {
      status: 'connected';
      session: GatewaySession;
    }
  | {
      status: 'rejected';
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export async function connectGatewaySession(
  ticketValue: string,
  connection: WebSocketConnectionLike,
  sessionRegistry: InMemoryGatewaySessionRegistry,
  options: RealtimeChatGatewayMountOptions,
  deps: RealtimeChatGatewayRuntimeDeps
): Promise<ConnectGatewaySessionResult> {
  const consumeResult = await deps.gatewayTicketPort.consume(ticketValue);

  if (consumeResult.status === 'rejected') {
    return {
      status: 'rejected',
      reason: consumeResult.reason,
      ...(consumeResult.message ? { message: consumeResult.message } : {})
    };
  }

  const session: GatewaySession = {
    sessionId: deps.idGenerator.generateId('gateway-session'),
    userId: consumeResult.ticket.actorId,
    gatewayId: options.gatewayId,
    connectedAt: deps.clock.now().toISOString(),
    connection,
    ...(consumeResult.ticket.workspaceId
      ? { workspaceId: consumeResult.ticket.workspaceId }
      : {})
  };

  sessionRegistry.register(session);
  deps.metrics?.increment('realtime_chat.gateway.session_connected');

  return {
    status: 'connected',
    session
  };
}
