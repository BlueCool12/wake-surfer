import type { RealtimeChatGatewayRuntimeDeps } from "@wake-surfer/realtime-chat/gateway";
import type { LoggerPort } from "@wake-surfer/realtime-chat/gateway";
import type { AppEnv } from "../config/env";
import { createNodeIdGenerator } from "./id-generator";
import { createNoopMetrics } from "./metrics";
import { createRedisOutboundEventBus } from "./redis-outbound-event-bus";
import {
  createHttpGatewayTicketConsumePort,
  createHttpRealtimeChatApiClient,
} from "./realtime-chat-api-client";

type RuntimeOutboundEventBus = RealtimeChatGatewayRuntimeDeps["outboundEventBus"] & {
  destroy?: () => Promise<void>;
};

export type RealtimeChatGatewayRuntimeHandle = {
  deps: RealtimeChatGatewayRuntimeDeps;
  close: () => Promise<void>;
};

export async function createRealtimeChatGatewayRuntimeDeps(
  env: AppEnv,
  logger: LoggerPort,
): Promise<RealtimeChatGatewayRuntimeHandle> {
  const outboundEventBus: RuntimeOutboundEventBus = await createRedisOutboundEventBus({
    redisUrl: env.REDIS_URL,
    channel: env.REALTIME_CHAT_OUTBOUND_CHANNEL,
    logger,
  });

  return {
    deps: {
      chatApiClient: createHttpRealtimeChatApiClient(env.REALTIME_CHAT_API_BASE_URL),
      gatewayTicketPort: createHttpGatewayTicketConsumePort(env.REALTIME_CHAT_API_BASE_URL),
      outboundEventBus,
      clock: {
        now: () => new Date(),
      },
      idGenerator: createNodeIdGenerator(),
      logger,
      metrics: createNoopMetrics(),
    },
    close: async () => {
      await outboundEventBus.destroy?.();
    },
  };
}
