import { mountRealtimeChatGateway } from "@wake-surfer/realtime-chat/gateway";
import type { RealtimeChatGatewayMountOptions } from "@wake-surfer/realtime-chat/gateway";
import type { AddressInfo } from "node:net";
import type { AppEnv } from "./config/env";
import { createLogger, toLoggerPort } from "./runtime/logger";
import {
  createRealtimeChatGatewayRuntimeDeps,
  type RealtimeChatGatewayRuntimeHandle,
} from "./runtime/create-runtime-deps";
import { createNodeRealtimeChatGatewayServer } from "./ws/ws-server";

export type RealtimeChatGatewayApp = {
  listen: (options?: { host?: string; port?: number }) => Promise<void>;
  address: () => AddressInfo | string | null;
  close: () => Promise<void>;
  logger: ReturnType<typeof createLogger>;
};

export async function createApp(
  env: AppEnv,
  createRuntime = createRealtimeChatGatewayRuntimeDeps,
): Promise<RealtimeChatGatewayApp> {
  const logger = createLogger(env);
  const loggerPort = toLoggerPort(logger);
  const server = createNodeRealtimeChatGatewayServer(loggerPort);
  const runtime = await createRuntime(env, loggerPort);

  await mountRealtimeChatGateway(server.wsServer, createMountOptions(env), runtime.deps);

  return {
    listen(options) {
      return server.listen({
        host: options?.host ?? env.HOST,
        port: options?.port ?? env.PORT,
      });
    },
    address: server.address,
    close: async () => {
      await server.close();
      await runtime.close();
    },
    logger,
  };
}

function createMountOptions(env: AppEnv): RealtimeChatGatewayMountOptions {
  return {
    path: env.REALTIME_CHAT_GATEWAY_PATH,
    gatewayId: env.GATEWAY_ID,
    maxPayloadBytes: env.MAX_PAYLOAD_BYTES,
  };
}

export type { RealtimeChatGatewayRuntimeHandle };
