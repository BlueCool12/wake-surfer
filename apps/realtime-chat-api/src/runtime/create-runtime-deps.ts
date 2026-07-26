import { createRealtimeChatDatabase } from "@wake-surfer/realtime-chat-database";
import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import {
  createMessageSendModule,
  type MessageWriteAuthorizer,
} from "@wake-surfer/realtime-chat-message-send";
import {
  createLoadLatestMessages,
  createLoadOlderMessages,
  createSyncAfterMessages,
  type ChannelReadAuthorizer,
} from "@wake-surfer/realtime-chat-stream-messages";

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
    // MVP 세로 흐름용 임시 정책이다. 실제 channel membership/permission provider로 교체해야 한다.
    const authorizeChannelRead: ChannelReadAuthorizer = () => ({ status: "allowed" });
    const authorizeMessageWrite: MessageWriteAuthorizer = ({ target }) =>
      target.type === "channel" ? { status: "allowed" } : { status: "denied" };
    const messageSend = createMessageSendModule({
      authorizeWrite: authorizeMessageWrite,
      db: database.db,
    });

    return {
      appDeps: {
        ...createHeaderAuthContext(config),
        cors: {
          allowedHeaders: [
            "authorization",
            "content-type",
            "x-request-id",
            config.actorIdHeader,
            config.gatewayIdHeader,
            config.gatewayAssertedActorHeader,
          ],
          allowedOrigins: config.corsAllowedOrigins,
        },
        gatewayTicket,
        gatewayApiToken: config.gatewayApiToken,
        checkReadiness: async () => {
          await database.db
            .selectNoFrom((expressionBuilder) => expressionBuilder.val(1).as("ready"))
            .executeTakeFirstOrThrow();
        },
        loadLatestMessages: createLoadLatestMessages({
          authorizeRead: authorizeChannelRead,
          db: database.db,
        }),
        loadOlderMessages: createLoadOlderMessages({
          authorizeRead: authorizeChannelRead,
          db: database.db,
        }),
        logger,
        messageSend,
        operationAbortMilliseconds: config.operationAbortMilliseconds,
        requestBodyLimitBytes: config.requestBodyLimitBytes,
        requestTimeoutMilliseconds: config.requestTimeoutMilliseconds,
        syncAfterMessages: createSyncAfterMessages({
          authorizeRead: authorizeChannelRead,
          db: database.db,
        }),
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
