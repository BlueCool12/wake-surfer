import { serve } from '@hono/node-server';
import { loadEnv } from './config/env';
import { createApp } from './app';

async function main(): Promise<void> {
  const env = loadEnv();
  const { app, logger, close } = await createApp(env);
  const server = serve({
    fetch: app.fetch,
    hostname: env.HOST,
    port: env.PORT
  });

  logger.info(
    {
      host: env.HOST,
      port: env.PORT,
      basePath: env.REALTIME_CHAT_BASE_PATH
    },
    'realtime chat api server listening'
  );

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'realtime chat api server shutting down');
    server.close((error) => {
      if (error) {
        logger.error({ error }, 'failed to close realtime chat api server');
        process.exit(1);
      }

      close()
        .then(() => process.exit(0))
        .catch((closeError: unknown) => {
          logger.error(
            { error: closeError },
            'failed to close realtime chat api runtime'
          );
          process.exit(1);
        });
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
