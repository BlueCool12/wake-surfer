import { mountRealtimeChatApi } from "@wake-surfer/realtime-chat/api";
import type { RealtimeChatApiMountOptions } from "@wake-surfer/realtime-chat/api";
import type { AppEnv } from "./config/env";
import { createHonoHttpServer } from "./http/hono-http-server";
import { createLogger, toLoggerPort } from "./runtime/logger";
import {
  createRealtimeChatApiRuntimeDeps,
  type RealtimeChatApiRuntimeHandle,
} from "./runtime/create-runtime-deps";

export async function createApp(env: AppEnv, createRuntime = createRealtimeChatApiRuntimeDeps) {
  const logger = createLogger(env);
  const loggerPort = toLoggerPort(logger);
  const server = createHonoHttpServer();
  const runtime = await createRuntime(env, loggerPort);

  server.app.get("/healthz", (context) =>
    context.json({
      status: "ok",
      service: "@wake-surfer/realtime-chat-api",
    }),
  );
  server.app.get("/readyz", (context) =>
    context.json({
      status: "ready",
      database: env.DATABASE_URL ? "configured" : "in-memory",
    }),
  );

  await mountRealtimeChatApi(server, createMountOptions(env), runtime.deps);

  return {
    app: server.app,
    logger,
    close: runtime.close,
  };
}

export type { RealtimeChatApiRuntimeHandle };

function createMountOptions(env: AppEnv): RealtimeChatApiMountOptions {
  return {
    basePath: env.REALTIME_CHAT_BASE_PATH,
    gatewayTicketTtlSeconds: env.GATEWAY_TICKET_TTL_SECONDS,
    maxMessageTextLength: env.MAX_MESSAGE_TEXT_LENGTH,
    syncDefaultLimit: env.SYNC_DEFAULT_LIMIT,
    syncMaxLimit: env.SYNC_MAX_LIMIT,
  };
}
