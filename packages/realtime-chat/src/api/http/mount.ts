import type { RealtimeChatApiRuntimeDeps } from "../runtime-deps";
import type { HttpServerLike } from "./http-server-like";
import { createRealtimeChatUsecases } from "../application/create-usecases";
import { registerRealtimeChatApiRoutes } from "./routes";

export type RealtimeChatApiMountOptions = {
  basePath: string;
  exposeOpenApi?: boolean;
  gatewayUrl?: string;
  gatewayTicketTtlSeconds?: number;
  maxMessageTextLength?: number;
  syncDefaultLimit?: number;
  syncMaxLimit?: number;
};

export async function mountRealtimeChatApi(
  server: HttpServerLike,
  options: RealtimeChatApiMountOptions,
  deps: RealtimeChatApiRuntimeDeps,
): Promise<void> {
  const usecases = createRealtimeChatUsecases(deps, options);
  await registerRealtimeChatApiRoutes(server, options, usecases);
  deps.logger.info("realtime chat api mounted", {
    basePath: options.basePath,
    exposeOpenApi: options.exposeOpenApi === true,
  });
}
