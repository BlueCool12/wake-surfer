import { createGatewayTicketApiClient } from "./realtime-chat-api-client.js";
import { createLogger } from "./logger.js";

import type { RealtimeChatGatewayConfig } from "../config/env.js";
import type { RealtimeChatGatewayAppDeps } from "../app.js";

export type RealtimeChatGatewayRuntime = {
  appDeps: RealtimeChatGatewayAppDeps;
  close: () => Promise<void>;
  config: RealtimeChatGatewayConfig;
};

export async function createRuntimeDeps(
  config: RealtimeChatGatewayConfig,
): Promise<RealtimeChatGatewayRuntime> {
  const logger = createLogger(config.logLevel);

  return {
    appDeps: {
      gatewayTicketConsumer: createGatewayTicketApiClient({
        apiBaseUrl: config.apiBaseUrl,
        gatewayIdHeader: config.apiGatewayIdHeader,
      }),
      logger,
    },
    close: async () => {},
    config,
  };
}
