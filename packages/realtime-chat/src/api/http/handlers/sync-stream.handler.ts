import type { RealtimeChatUsecases } from "../../application/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { badRequest, forbidden, ok } from "./response";
import { parseSyncStreamMessagesRequest } from "../schemas/stream-sync.schema";

export function createSyncStreamHandler(usecases: RealtimeChatUsecases): HttpRouteHandler {
  return async (request) => {
    const parsed = parseSyncStreamMessagesRequest(request.params, request.query);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    const result = await usecases.syncStreamMessages(parsed.value);

    if (result.status === "rejected") {
      return forbidden(result.reason, result.message);
    }

    return ok(result.response);
  };
}
