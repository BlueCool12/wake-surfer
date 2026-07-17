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

type RuntimeFactories = {
  createDatabase: typeof createRealtimeChatDatabase;
};

const defaultRuntimeFactories: RuntimeFactories = {
  createDatabase: createRealtimeChatDatabase,
};

export async function createRuntimeDeps(
  env: NodeJS.ProcessEnv = process.env,
  factories: RuntimeFactories = defaultRuntimeFactories,
): Promise<RealtimeChatApiRuntime> {
  const config = loadEnv(env);
  const logger = createLogger(config.logLevel);
  const database = factories.createDatabase({
    databaseUrl: config.databaseUrl,
    pool: config.postgresPool,
  });

  try {
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
        checkReadiness: async () => {
          await database.db.selectFrom("gateway_tickets").select("ticket_hash").limit(1).execute();
        },
        gatewayTicket,
        logger,
      },
      close: async () => {
        await database.close();
      },
      config,
    };
  } catch (startupError) {
    try {
      await database.close();
    } catch (closeError) {
      throw new AggregateError(
        [startupError, closeError],
        "실시간 채팅 API 런타임 초기화와 데이터베이스 정리에 실패했습니다.",
      );
    }

    throw startupError;
  }
}
