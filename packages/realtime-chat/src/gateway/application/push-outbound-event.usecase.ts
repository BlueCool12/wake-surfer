import type { OutboundMessageDeliveryRequested } from '@wake-surfer/realtime-chat-contracts';
import type { RealtimeChatGatewayRuntimeDeps } from '../runtime-deps';
import type { InMemoryGatewaySessionRegistry } from '../session/in-memory-gateway-session-registry';
import { sendSocketEvent } from '../websocket/send-socket-event';

export async function pushOutboundEvent(
  event: OutboundMessageDeliveryRequested,
  sessionRegistry: InMemoryGatewaySessionRegistry,
  deps: RealtimeChatGatewayRuntimeDeps
): Promise<void> {
  const sessions = sessionRegistry.findByUserIds(event.recipientUserIds);

  for (const session of sessions) {
    try {
      await sendSocketEvent(session.connection, event.payload);
      deps.metrics?.increment('realtime_chat.gateway.outbound_pushed', {
        streamType: event.streamType
      });
    } catch (error) {
      sessionRegistry.unregister(session.sessionId);
      deps.logger.warn('failed to push realtime chat outbound event', {
        error,
        sessionId: session.sessionId,
        streamId: event.streamId,
        messageId: event.messageId
      });
    }
  }
}
