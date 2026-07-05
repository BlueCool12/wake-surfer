import type { RealtimeChatUsecases } from "../../application/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { badRequest, ok } from "./response";
import { parseConsumeGatewayTicketRequest } from "../schemas/consume-gateway-ticket.schema";

export function createConsumeGatewayTicketHandler(
  usecases: RealtimeChatUsecases,
): HttpRouteHandler {
  return async (request) => {
    const parsed = parseConsumeGatewayTicketRequest(request.body);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    return ok(await usecases.consumeGatewayTicket(parsed.value));
  };
}
