import { createRealtimeChatDatabase } from "@wake-surfer/realtime-chat-database";
import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";

import { loadEnv } from "../config/env.js";

import { createHeaderAuthContext } from "./auth-context.js";
import { createLogger } from "./logger.js";

import type { RealtimeChatApiAppDeps } from "../app.js";
import type { RealtimeChatApiConfig } from "../config/env.js";

export type RealtimeChatApiRuntime = {
  appDeps: RealtimeChatApiAppDeps;
  close: () => Promise<void>;
  config: RealtimeChatApiConfig;
};

export async function createRuntimeDeps(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RealtimeChatApiRuntime> {
  const config = loadEnv(env);
  const logger = createLogger(config.logLevel);
  const database = createRealtimeChatDatabase({
    databaseUrl: config.databaseUrl,
    pool: config.postgresPool,
  });

  const gatewayTicket = createGatewayTicketModule({
    assignGateway: createStaticGatewayAssigner({
      gatewayId: config.gatewayId,
      gatewayUrl: config.gatewayUrl,
    }),
    db: database.db,
    rawTicketBytes: config.gatewayTicketRawBytes,
    ticketTtlMilliseconds: config.gatewayTicketTtlMilliseconds,
  });

  await database.migrate();

  return {
    appDeps: {
      ...createHeaderAuthContext(config),
      gatewayTicket,
      logger,
    },
    close: async () => {
      await database.close();
    },
    config,
  };
}
