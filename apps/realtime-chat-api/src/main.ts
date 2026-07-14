import { serve } from "@hono/node-server";

import { createRealtimeChatApiApp } from "./app.js";
import { createRuntimeDeps } from "./runtime/create-runtime-deps.js";

const runtime = await createRuntimeDeps();
let isShuttingDown = false;
const app = createRealtimeChatApiApp(runtime.appDeps, {
  corsOrigins: runtime.config.corsOrigins,
  handlerTimeoutMilliseconds: runtime.config.handlerTimeoutMilliseconds,
  isDraining: () => isShuttingDown,
  operationAbortMilliseconds:
    runtime.config.handlerTimeoutMilliseconds -
    runtime.config.postgresPool.connectionTimeoutMillis -
    runtime.config.postgresPool.statementTimeoutMillis,
  requestBodyLimitBytes: runtime.config.requestBodyLimitBytes,
});

const server = serve(
  {
    fetch: app.fetch,
    port: runtime.config.port,
    serverOptions: {
      headersTimeout: runtime.config.httpHeadersTimeoutMilliseconds,
      keepAliveTimeout: runtime.config.httpKeepAliveTimeoutMilliseconds,
      requestTimeout: runtime.config.httpRequestTimeoutMilliseconds,
    },
  },
  (info) => {
    runtime.appDeps.logger.info(
      {
        port: info.port,
      },
      "realtime chat api started",
    );
  },
);

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  runtime.appDeps.logger.info({ signal }, "realtime chat api shutting down");

  void closeRuntime();
}

async function closeRuntime(): Promise<void> {
  const forceCloseTimer = setTimeout(() => {
    runtime.appDeps.logger.warn({}, "realtime chat api shutdown grace exceeded");
    if ("closeAllConnections" in server) {
      server.closeAllConnections();
    }
  }, runtime.config.shutdownGraceMilliseconds);
  forceCloseTimer.unref();

  let shutdownFailed = false;

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  } catch (error) {
    shutdownFailed = true;
    runtime.appDeps.logger.error({ error }, "realtime chat api HTTP shutdown failed");
  }

  try {
    await runtime.close();
  } catch (error) {
    shutdownFailed = true;
    runtime.appDeps.logger.error({ error }, "realtime chat api runtime shutdown failed");
  }

  clearTimeout(forceCloseTimer);

  if (shutdownFailed) {
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
