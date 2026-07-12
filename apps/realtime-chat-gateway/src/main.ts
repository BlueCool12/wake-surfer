import { createRealtimeChatGatewayApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createRuntimeDeps } from "./runtime/create-runtime-deps.js";

const config = loadEnv();
const runtime = await createRuntimeDeps(config);
const app = createRealtimeChatGatewayApp(runtime.config, runtime.appDeps);

await app.listen();

runtime.appDeps.logger.info(
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
  runtime.appDeps.logger.info({ signal }, "실시간 채팅 게이트웨이 종료 시작");

  app
    .close()
    .then(() => runtime.close())
    .catch((error: unknown) => {
      runtime.appDeps.logger.error({ error }, "실시간 채팅 게이트웨이 종료 실패");
      process.exitCode = 1;
    });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
