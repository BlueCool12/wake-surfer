import { createRealtimeChatDatabase } from "@wake-surfer/realtime-chat-database";
import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import {
  createSendMessage,
  type MessageTargetResolver,
  type MessageWriteAuthorizer,
} from "@wake-surfer/realtime-chat-message-send";
import { getCanonicalStreamId } from "@wake-surfer/realtime-chat-message-contracts";
import {
  createDeleteMessage,
  createEditMessage,
  type MessageMutationAuthorizer,
} from "@wake-surfer/realtime-chat-message-mutation";
import {
  createLoadLatestMessages,
  createLoadOlderMessages,
  createSyncAfterMessages,
  type MessageStreamReadAuthorizer,
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
    const authorizeMessageStreamRead: MessageStreamReadAuthorizer = () => ({
      status: "allowed",
    });
    const resolveMessageTarget: MessageTargetResolver = ({ target }) => ({
      status: "resolved",
      streamId: getCanonicalStreamId(target),
    });
    const authorizeMessageWrite: MessageWriteAuthorizer = ({ target }) =>
      target.type === "channel" || target.type === "thread"
        ? { status: "allowed" }
        : { status: "denied" };
    const authorizeMessageMutation: MessageMutationAuthorizer = ({ target }) =>
      target.type === "channel" || target.type === "thread";
    const sendMessage = createSendMessage({
      authorizeWrite: authorizeMessageWrite,
      db: database.db,
      resolveTarget: resolveMessageTarget,
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
        deleteMessage: createDeleteMessage({
          authorize: authorizeMessageMutation,
          db: database.db,
        }),
        editMessage: createEditMessage({
          authorize: authorizeMessageMutation,
          db: database.db,
        }),
        gatewayTicket,
        gatewayApiToken: config.gatewayApiToken,
        loadLatestMessages: createLoadLatestMessages({
          authorizeRead: authorizeMessageStreamRead,
          db: database.db,
        }),
        loadOlderMessages: createLoadOlderMessages({
          authorizeRead: authorizeMessageStreamRead,
          db: database.db,
        }),
        logger,
        sendMessage,
        requestTimeoutMilliseconds: config.requestTimeoutMilliseconds,
        syncAfterMessages: createSyncAfterMessages({
          authorizeRead: authorizeMessageStreamRead,
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
