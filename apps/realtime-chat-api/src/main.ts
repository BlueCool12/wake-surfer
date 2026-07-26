import { serve } from "@hono/node-server";

import { createRealtimeChatApiApp } from "./app.js";
import { createRuntimeDeps } from "./runtime/create-runtime-deps.js";

const runtime = await createRuntimeDeps();
const app = createRealtimeChatApiApp(runtime.appDeps);

const server = serve(
  {
    fetch: app.fetch,
    port: runtime.config.port,
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

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  runtime.appDeps.logger.info({ signal }, "realtime chat api shutting down");

  server.close((error) => {
    runtime
      .close()
      .then(() => {
        if (error) {
          runtime.appDeps.logger.error({ error }, "http server shutdown failed");
          process.exitCode = 1;
        }
      })
      .catch((closeError: unknown) => {
        runtime.appDeps.logger.error({ error: closeError }, "runtime shutdown failed");
        process.exitCode = 1;
      });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
