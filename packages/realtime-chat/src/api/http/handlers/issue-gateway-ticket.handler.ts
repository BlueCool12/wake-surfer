import type { RealtimeChatUsecases } from "../../application/create-usecases";
import type { HttpRouteHandler } from "../http-server-like";
import { extractActorId } from "../actor-context";
import { badRequest, created, forbidden } from "./response";
import { parseIssueGatewayTicketRequest } from "../schemas/issue-gateway-ticket.schema";

export function createIssueGatewayTicketHandler(usecases: RealtimeChatUsecases): HttpRouteHandler {
  return async (request) => {
    const parsed = parseIssueGatewayTicketRequest(request.body, extractActorId(request));

    if (!parsed.ok) {
      return badRequest(parsed.message);
    }

    const result = await usecases.issueGatewayTicket({
      actorId: parsed.value.actorId,
      ...(parsed.value.workspaceId ? { workspaceId: parsed.value.workspaceId } : {}),
    });

    if (result.status === "rejected") {
      return forbidden(result.reason, result.message);
    }

    return created(result.response);
  };
}
