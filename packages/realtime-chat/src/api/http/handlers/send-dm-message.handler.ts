import type { RealtimeChatUsecases } from "../../usecases/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { badRequest, ok } from "./response";
import { parseSendDMMessageRequest } from "../schemas/message-command.schema";

export function createSendDMMessageHandler(usecases: RealtimeChatUsecases): HttpRouteHandler {
  return async (request) => {
    const parsed = parseSendDMMessageRequest(request.body);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    return ok(await usecases.sendDMMessage(parsed.value));
  };
}
