import type {
  ActorId,
  IssueGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type { Kysely } from "kysely";
import {
  assertActorId,
  assertGatewayAssignment,
  createGatewayTicketTimestamps,
  defaultRawGatewayTicketGenerator,
  defaultTicketHasher,
} from "../../gateway-ticket";
import type {
  GatewayAssignment,
  GatewayTicketPolicy,
  RawGatewayTicketGenerator,
  TicketHasher,
} from "../../gateway-ticket";
import type { GatewayTicketDatabase } from "../../gateway-ticket-table";
import { throwIfGatewayTicketOperationAborted } from "../../operation-context";
import { saveIssuedGatewayTicket } from "./issue-gateway-ticket.kysely";

export type IssueGatewayTicketCommand = {
  actorId: ActorId;
};

export type GatewayAssigner = (input: {
  actorId: ActorId;
}) => GatewayAssignment | Promise<GatewayAssignment>;

export type IssueGatewayTicketDeps = {
  db: Kysely<GatewayTicketDatabase>;
  now: () => Date;
  assignGateway: GatewayAssigner;
  ticketPolicy: GatewayTicketPolicy;
  rawTicketGenerator?: RawGatewayTicketGenerator;
  signal?: AbortSignal;
  ticketHasher?: TicketHasher;
};

export type StaticGatewayAssignmentInput = {
  gatewayId: GatewayAssignment["gatewayId"];
  gatewayUrl: GatewayAssignment["gatewayUrl"];
};

export function createStaticGatewayAssigner(input: StaticGatewayAssignmentInput): GatewayAssigner {
  assertGatewayAssignment(input);

  return () => ({
    gatewayId: input.gatewayId,
    gatewayUrl: input.gatewayUrl,
  });
}

export async function issueGatewayTicket(
  command: IssueGatewayTicketCommand,
  deps: IssueGatewayTicketDeps,
): Promise<IssueGatewayTicketResponse> {
  assertActorId(command.actorId);
  throwIfGatewayTicketOperationAborted(deps.signal);

  const policy = deps.ticketPolicy;
  const now = deps.now();
  const timestamps = createGatewayTicketTimestamps(now, policy);
  const assignment = await deps.assignGateway({
    actorId: command.actorId,
  });
  throwIfGatewayTicketOperationAborted(deps.signal);
  assertGatewayAssignment(assignment);

  const rawTicketGenerator = deps.rawTicketGenerator ?? defaultRawGatewayTicketGenerator;
  const ticketHasher = deps.ticketHasher ?? defaultTicketHasher;
  const ticket = rawTicketGenerator.generate(policy.rawTicketBytes);
  const ticketHash = await ticketHasher.hash(ticket);
  throwIfGatewayTicketOperationAborted(deps.signal);

  await saveIssuedGatewayTicket(deps.db, {
    ticketHash,
    actorId: command.actorId,
    assignedGatewayId: assignment.gatewayId,
    issuedAt: timestamps.issuedAt,
    expiresAt: timestamps.expiresAt,
  });

  return {
    ticket,
    gatewayUrl: assignment.gatewayUrl,
    expiresAt: timestamps.expiresAt,
  };
}
