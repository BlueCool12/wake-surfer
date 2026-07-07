import type { RealtimeChatGatewayRuntimeDeps } from "../runtime-deps";
import { routeClientEvent } from "../usecases/route-client-event.usecase";
import type { GatewaySession } from "../session/gateway-session";
import type { InMemoryGatewaySessionRegistry } from "../session/in-memory-gateway-session-registry";
import type { RealtimeChatGatewayMountOptions } from "./mount";
import type { WebSocketMessagePayload } from "./websocket-server-like";
import { parseRealtimeChatClientEvent } from "./schemas";
import { sendSocketEvent } from "./send-socket-event";

export async function handleSocketMessage(
  payload: WebSocketMessagePayload,
  session: GatewaySession,
  sessionRegistry: InMemoryGatewaySessionRegistry,
  options: RealtimeChatGatewayMountOptions,
  deps: RealtimeChatGatewayRuntimeDeps,
): Promise<void> {
  const parsed = parseRealtimeChatClientEvent(
    payloadToString(payload),
    options.maxPayloadBytes ?? 64 * 1024,
  );

  if (!parsed.ok) {
    await sendSocketEvent(session.connection, {
      type: "gateway.error",
      reason: parsed.reason,
      ...(parsed.message ? { message: parsed.message } : {}),
    });
    return;
  }

  const event = await routeClientEvent(parsed.event, session, deps);
  await sendSocketEvent(session.connection, event);
  deps.metrics?.increment("realtime_chat.gateway.client_event_routed", {
    eventType: parsed.event.type,
  });

  if (event.type === "gateway.error" && event.reason === "GATEWAY_SESSION_NOT_FOUND") {
    sessionRegistry.unregister(session.sessionId);
  }
}

function payloadToString(payload: WebSocketMessagePayload): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload instanceof Uint8Array) {
    return new TextDecoder().decode(payload);
  }

  return new TextDecoder().decode(new Uint8Array(payload));
}
