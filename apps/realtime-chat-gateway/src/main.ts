import { createGatewayStreamMessagesApiClient } from "@wake-surfer/realtime-chat-stream-messages-gateway";

import { createRealtimeChatGatewayApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createGatewayApiClient } from "./runtime/gateway-api-client.js";
import { createLogger } from "./runtime/logger.js";

const config = loadEnv();
const logger = createLogger(config.logLevel);
const gatewayApiClient = createGatewayApiClient({
  actorHeader: config.apiActorHeader,
  apiBaseUrl: config.apiBaseUrl,
  gatewayApiToken: config.gatewayApiToken,
  gatewayId: config.gatewayId,
  gatewayIdHeader: config.apiGatewayIdHeader,
  timeoutMilliseconds: config.apiRequestTimeoutMilliseconds,
});
const streamMessagesApiClient = createGatewayStreamMessagesApiClient({
  actorHeader: config.apiActorHeader,
  apiBaseUrl: config.apiBaseUrl,
  gatewayApiToken: config.gatewayApiToken,
  gatewayId: config.gatewayId,
  gatewayIdHeader: config.apiGatewayIdHeader,
  nodeEnvironment: config.nodeEnvironment,
  timeoutMilliseconds: config.apiRequestTimeoutMilliseconds,
  transportSecurity: config.internalTransportSecurity,
});
const app = createRealtimeChatGatewayApp(config, {
  gatewayApiClient,
  logger,
  streamMessagesApiClient,
});

await app.listen();
logger.info(
  {
    gatewayId: config.gatewayId,
    path: config.gatewayPath,
    port: config.port,
  },
  "실시간 채팅 게이트웨이 시작",
);

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, "실시간 채팅 게이트웨이 종료 시작");
  void app.close().catch((error: unknown) => {
    logger.error(
      {
        error:
          error instanceof Error
            ? { message: error.message, name: error.name, stack: error.stack }
            : { value: String(error) },
      },
      "실시간 채팅 게이트웨이 종료 실패",
    );
    process.exitCode = 1;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
