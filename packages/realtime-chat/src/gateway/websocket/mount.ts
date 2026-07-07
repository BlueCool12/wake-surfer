import type { RealtimeChatGatewayRuntimeDeps } from "../runtime-deps";
import { pushOutboundEvent } from "../usecases/push-outbound-event.usecase";
import { InMemoryGatewaySessionRegistry } from "../session/in-memory-gateway-session-registry";
import type { WebSocketServerLike } from "./websocket-server-like";
import { createConnectionHandler } from "./connection-handler";

export type RealtimeChatGatewayMountOptions = {
  path: string;
  gatewayId: string;
  maxPayloadBytes?: number;
};

export async function mountRealtimeChatGateway(
  server: WebSocketServerLike,
  options: RealtimeChatGatewayMountOptions,
  deps: RealtimeChatGatewayRuntimeDeps,
): Promise<void> {
  const sessionRegistry = new InMemoryGatewaySessionRegistry();

  await server.route({
    path: options.path,
    onConnection: createConnectionHandler(sessionRegistry, options, deps),
  });

  await deps.outboundEventBus.subscribe((event) => pushOutboundEvent(event, sessionRegistry, deps));

  deps.logger.info("realtime chat gateway mounted", {
    path: options.path,
    gatewayId: options.gatewayId,
  });
}
