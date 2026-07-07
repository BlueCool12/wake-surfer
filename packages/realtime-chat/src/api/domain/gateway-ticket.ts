import type {
  GatewayTicket,
  ISODateTime,
  IssueGatewayTicketResponse,
  UserId,
} from "@wake-surfer/realtime-chat-contracts";
import type { AssignedGateway, StoredGatewayTicket, TicketHasherPort } from "../runtime-deps";

export type IssuedGatewayTicket = {
  ticketValue: GatewayTicket;
  ticketValueHash: string;
  actorId: UserId;
  assignedGateway: AssignedGateway;
  issuedAt: ISODateTime;
  expiresAt: ISODateTime;
};

export type IssueGatewayTicketDomainInput = {
  actorId: UserId;
  assignedGateway: AssignedGateway;
  issuedAt: Date;
  ticketTtlSeconds: number;
  generateId: (scope: string) => string;
  hashTicket: (ticketValue: GatewayTicket) => string | Promise<string>;
};

export const defaultTicketHasher: TicketHasherPort = {
  async hash(ticketValue: string): Promise<string> {
    const cryptoApi = globalThis.crypto;

    if (!cryptoApi?.subtle) {
      throw new Error("crypto.subtle is required for gateway ticket hashing");
    }

    const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(ticketValue));
    const bytes = new Uint8Array(digest);
    let hex = "";

    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }

    return `sha256:${hex}`;
  },
};

export async function issueGatewayTicketDomain(
  input: IssueGatewayTicketDomainInput,
): Promise<IssuedGatewayTicket> {
  const ticketValue = createGatewayTicketValue({
    ticketId: input.generateId("gateway-ticket"),
    secret: input.generateId("gateway-ticket-secret"),
  });
  const expiresAt = calculateGatewayTicketExpiresAt({
    issuedAt: input.issuedAt,
    ttlSeconds: input.ticketTtlSeconds,
  });

  return {
    ticketValue,
    ticketValueHash: await input.hashTicket(ticketValue),
    actorId: input.actorId,
    assignedGateway: input.assignedGateway,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function toStoredGatewayTicket(ticket: IssuedGatewayTicket): StoredGatewayTicket {
  return {
    ticketValueHash: ticket.ticketValueHash,
    actorId: ticket.actorId,
    assignedGatewayId: ticket.assignedGateway.gatewayId,
    issuedAt: ticket.issuedAt,
    expiresAt: ticket.expiresAt,
  };
}

export function toIssueGatewayTicketResponse(
  ticket: IssuedGatewayTicket,
): IssueGatewayTicketResponse {
  return {
    ticket: ticket.ticketValue,
    gatewayUrl: ticket.assignedGateway.gatewayUrl,
    expiresAt: ticket.expiresAt,
  };
}

function createGatewayTicketValue(input: { ticketId: string; secret: string }): GatewayTicket {
  return [input.ticketId, input.secret].join(".");
}

function calculateGatewayTicketExpiresAt(input: { issuedAt: Date; ttlSeconds: number }): Date {
  return new Date(input.issuedAt.getTime() + input.ttlSeconds * 1000);
}
