import { loadEnv } from "./config/env";
import { createApp } from "./app";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp(env);

  await app.listen();

  app.logger.info(
    {
      host: env.HOST,
      port: env.PORT,
      path: env.REALTIME_CHAT_GATEWAY_PATH,
      gatewayId: env.GATEWAY_ID,
    },
    "realtime chat gateway server listening",
  );

  const shutdown = (signal: NodeJS.Signals) => {
    app.logger.info({ signal }, "realtime chat gateway server shutting down");
    app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.logger.error({ error }, "failed to close realtime chat gateway server");
        process.exit(1);
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
