import type { RealtimeChatUsecases } from "../../usecases/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { badRequest, ok } from "./response";
import { parsePostSessionStartedSystemMessageRequest } from "../schemas/message-command.schema";

export function createPostSessionStartedSystemMessageHandler(
  usecases: RealtimeChatUsecases,
): HttpRouteHandler {
  return async (request) => {
    const parsed = parsePostSessionStartedSystemMessageRequest(request.body);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    return ok(await usecases.postSessionStartedSystemMessage(parsed.value));
  };
}
