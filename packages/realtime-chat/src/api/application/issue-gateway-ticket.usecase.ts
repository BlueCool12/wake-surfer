import type {
  IssueGatewayTicketRequest,
  IssueGatewayTicketResponse,
  RealtimeChatErrorCode,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatApiMountOptions } from "../http/mount";
import type { RealtimeChatApiRuntimeDeps } from "../runtime-deps";
import { defaultTicketHasher } from "../domain/gateway-ticket";

export type IssueGatewayTicketResult =
  | {
      status: "issued";
      response: IssueGatewayTicketResponse;
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export async function issueGatewayTicket(
  request: IssueGatewayTicketRequest,
  deps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions,
): Promise<IssueGatewayTicketResult> {
  const ticketDecision = deps.permissionPort.canIssueGatewayTicket
    ? await deps.permissionPort.canIssueGatewayTicket({
        actorId: request.actorId,
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      })
    : { allowed: true as const };

  if (!ticketDecision.allowed) {
    return {
      status: "rejected",
      reason: ticketDecision.reason,
      ...(ticketDecision.message ? { message: ticketDecision.message } : {}),
    };
  }

  const ttlSeconds = options.gatewayTicketTtlSeconds ?? 60;
  const issuedAtDate = deps.clock.now();
  const expiresAtDate = new Date(issuedAtDate.getTime() + ttlSeconds * 1000);
  const ticket = [
    deps.idGenerator.generateId("gateway-ticket"),
    deps.idGenerator.generateId("gateway-ticket-secret"),
  ].join(".");
  const hasher = deps.ticketHasher ?? defaultTicketHasher;
  const ticketValueHash = await hasher.hash(ticket);

  await deps.db.issueGatewayTicket({
    ticketValueHash,
    actorId: request.actorId,
    ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
  });

  return {
    status: "issued",
    response: {
      ticket,
      ...(options.gatewayUrl ? { gatewayUrl: options.gatewayUrl } : {}),
      expiresAt: expiresAtDate.toISOString(),
    },
  };
}
