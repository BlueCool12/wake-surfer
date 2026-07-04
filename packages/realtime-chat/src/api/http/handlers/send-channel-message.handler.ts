import type { RealtimeChatUsecases } from '../../application/create-usecases';
import type { HttpRouteHandler } from '../http-server-like';
import { badRequest, ok } from './response';
import { parseSendChannelMessageRequest } from '../schemas/message-command.schema';

export function createSendChannelMessageHandler(
  usecases: RealtimeChatUsecases
): HttpRouteHandler {
  return async (request) => {
    const parsed = parseSendChannelMessageRequest(request.body);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    return ok(await usecases.sendChannelMessage(parsed.value));
  };
}
