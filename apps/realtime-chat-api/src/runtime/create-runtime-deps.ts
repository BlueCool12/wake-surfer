import type { RealtimeChatApiRuntimeDeps } from "@wake-surfer/realtime-chat/api";
import type { LoggerPort } from "@wake-surfer/realtime-chat/api";
import type { AppEnv } from "../config/env";
import { createInMemoryRealtimeChatDb } from "./in-memory-realtime-chat-db";
import { createNodeIdGenerator } from "./id-generator";
import { createNoopMetrics } from "./metrics";
import { createAllowAllPermissionPort } from "./permission-port";
import { createPostgresRealtimeChatDb } from "./postgres-realtime-chat-db";
import { createRedisOutboundEventBus } from "./redis-outbound-event-bus";
import { createNodeGatewayTicketHasher } from "./ticket-hasher";

type RuntimeDb = RealtimeChatApiRuntimeDeps["db"] & {
  destroy?: () => Promise<void>;
};

type RuntimeOutboundEventBus = RealtimeChatApiRuntimeDeps["outboundEventBus"] & {
  destroy?: () => Promise<void>;
};

export type RealtimeChatApiRuntimeHandle = {
  deps: RealtimeChatApiRuntimeDeps;
  close: () => Promise<void>;
};

export async function createRealtimeChatApiRuntimeDeps(
  env: AppEnv,
  logger: LoggerPort,
): Promise<RealtimeChatApiRuntimeHandle> {
  const db: RuntimeDb = env.DATABASE_URL
    ? await createPostgresRealtimeChatDb(env.DATABASE_URL)
    : createInMemoryRealtimeChatDb();
  const outboundEventBus: RuntimeOutboundEventBus = await createRedisOutboundEventBus({
    redisUrl: env.REDIS_URL,
    channel: env.REALTIME_CHAT_OUTBOUND_CHANNEL,
    logger,
  });

  return {
    deps: {
      db,
      permissionPort: createAllowAllPermissionPort(),
      outboundEventBus,
      clock: {
        now: () => new Date(),
      },
      idGenerator: createNodeIdGenerator(),
      logger,
      metrics: createNoopMetrics(),
      ticketHasher: createNodeGatewayTicketHasher(),
    },
    close: async () => {
      await outboundEventBus.destroy?.();
      await db.destroy?.();
    },
  };
}
