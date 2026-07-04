import type { GatewaySessionId } from '@wake-surfer/realtime-chat-contracts';
import type { RealtimeChatGatewayRuntimeDeps } from '../runtime-deps';
import type { InMemoryGatewaySessionRegistry } from '../session/in-memory-gateway-session-registry';

export function closeGatewaySession(
  sessionId: GatewaySessionId,
  sessionRegistry: InMemoryGatewaySessionRegistry,
  deps: RealtimeChatGatewayRuntimeDeps
): void {
  sessionRegistry.unregister(sessionId);
  deps.metrics?.increment('realtime_chat.gateway.session_closed');
}
