import type { RealtimeChatUsecases } from "../../application/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { badRequest, ok } from "./response";
import { parseReplyThreadMessageRequest } from "../schemas/message-command.schema";

export function createReplyThreadMessageHandler(usecases: RealtimeChatUsecases): HttpRouteHandler {
  return async (request) => {
    const parsed = parseReplyThreadMessageRequest(request.body);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    return ok(await usecases.replyThreadMessage(parsed.value));
  };
}
