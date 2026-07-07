import type { RealtimeChatUsecases } from "../../usecases/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { extractActorId } from "../actor-context";
import { badRequest, created, forbidden, unauthorized } from "./response";
import { parseIssueGatewayTicketRequest } from "../schemas/issue-gateway-ticket.schema";

export function createIssueGatewayTicketHandler(usecases: RealtimeChatUsecases): HttpRouteHandler {
  return async (request) => {
    const parsed = parseIssueGatewayTicketRequest(request.body);

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    const actorId = extractActorId(request);

    if (!actorId) {
      return unauthorized("authenticated actor is required");
    }

    const result = await usecases.issueGatewayTicket({
      actorId,
    });

    if (result.status === "rejected") {
      return forbidden(result.reason, result.message);
    }

    return created(result.response);
  };
}
