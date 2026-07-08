import type {
  ActorId,
  IssueGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import {
  createGatewayTicketTimestamps,
  defaultGatewayTicketPolicy,
  defaultRawGatewayTicketGenerator,
  defaultTicketHasher,
} from "../../gateway-ticket";
import type {
  GatewayAssignment,
  GatewayTicketPolicy,
  IssuedGatewayTicket,
  RawGatewayTicketGenerator,
  TicketHasher,
} from "../../gateway-ticket";

export type IssueGatewayTicketCommand = {
  actorId: ActorId;
};

export type GatewayAssigner = (input: {
  actorId: ActorId;
}) => GatewayAssignment | Promise<GatewayAssignment>;

export type IssueGatewayTicketDeps = {
  now: () => Date;
  assignGateway: GatewayAssigner;
  saveIssuedGatewayTicket: (ticket: IssuedGatewayTicket) => Promise<void>;
  rawTicketGenerator?: RawGatewayTicketGenerator;
  ticketHasher?: TicketHasher;
};

export type IssueGatewayTicketOptions = {
  ticketPolicy?: GatewayTicketPolicy;
};

export type StaticGatewayAssignmentInput = {
  gatewayId: GatewayAssignment["gatewayId"];
  gatewayUrl: GatewayAssignment["gatewayUrl"];
};

export function createStaticGatewayAssigner(input: StaticGatewayAssignmentInput): GatewayAssigner {
  return () => ({
    gatewayId: input.gatewayId,
    gatewayUrl: input.gatewayUrl,
  });
}

export async function issueGatewayTicket(
  command: IssueGatewayTicketCommand,
  deps: IssueGatewayTicketDeps,
  options: IssueGatewayTicketOptions = {},
): Promise<IssueGatewayTicketResponse> {
  const policy = options.ticketPolicy ?? defaultGatewayTicketPolicy;
  const now = deps.now();
  const timestamps = createGatewayTicketTimestamps(now, policy);
  const assignment = await deps.assignGateway({
    actorId: command.actorId,
  });
  const rawTicketGenerator = deps.rawTicketGenerator ?? defaultRawGatewayTicketGenerator;
  const ticketHasher = deps.ticketHasher ?? defaultTicketHasher;
  const ticket = rawTicketGenerator.generate(policy.rawTicketBytes);
  const ticketHash = await ticketHasher.hash(ticket);

  await deps.saveIssuedGatewayTicket({
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
