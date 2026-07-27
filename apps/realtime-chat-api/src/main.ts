import { serve } from "@hono/node-server";

import { createRealtimeChatApiApp } from "./app.js";
import { MAX_REALTIME_CHAT_REQUEST_BODY_UTF8_BYTES } from "./http/request-body-policy.js";
import { createRuntimeDeps } from "./runtime/create-runtime-deps.js";

const runtime = await createRuntimeDeps();
let isShuttingDown = false;
const app = createRealtimeChatApiApp({
  ...runtime.appDeps,
  isDraining: () => isShuttingDown,
});

const server = serve(
  {
    fetch: app.fetch,
    hostname: runtime.config.host,
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
        host: runtime.config.host,
        port: info.port,
        runtimePolicy: {
          actorAuthSecurity: runtime.config.actorAuthSecurity,
          corsAllowedOriginCount: runtime.config.corsAllowedOrigins.length,
          corsAllowedOrigins: runtime.config.corsAllowedOrigins,
          gatewayTicketRawBytes: runtime.config.gatewayTicketRawBytes,
          gatewayTicketTtlMilliseconds: runtime.config.gatewayTicketTtlMilliseconds,
          httpHeadersTimeoutMilliseconds: runtime.config.httpHeadersTimeoutMilliseconds,
          httpKeepAliveTimeoutMilliseconds: runtime.config.httpKeepAliveTimeoutMilliseconds,
          httpRequestTimeoutMilliseconds: runtime.config.httpRequestTimeoutMilliseconds,
          internalTransportSecurity: runtime.config.internalTransportSecurity,
          nodeEnvironment: runtime.config.nodeEnvironment,
          operationAbortMilliseconds: runtime.config.operationAbortMilliseconds,
          postgresConnectionTimeoutMilliseconds:
            runtime.config.postgresPool.connectionTimeoutMillis,
          postgresIdleTimeoutMilliseconds: runtime.config.postgresPool.idleTimeoutMillis,
          postgresMaxLifetimeSeconds: runtime.config.postgresPool.maxLifetimeSeconds,
          postgresPoolMax: runtime.config.postgresPool.max,
          postgresStatementTimeoutMilliseconds: runtime.config.postgresPool.statementTimeoutMillis,
          requestBodyLimitBytes: MAX_REALTIME_CHAT_REQUEST_BODY_UTF8_BYTES,
          requestTimeoutMilliseconds: runtime.config.requestTimeoutMilliseconds,
          shutdownGraceMilliseconds: runtime.config.shutdownGraceMilliseconds,
        },
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
  if ("closeIdleConnections" in server) {
    server.closeIdleConnections();
  }

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
