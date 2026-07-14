import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type { Kysely } from "kysely";
import { assertGatewayId, defaultTicketHasher } from "../../gateway-ticket";
import type { GatewayId, TicketHasher } from "../../gateway-ticket";
import type { GatewayTicketDatabase } from "../../gateway-ticket-table";
import { throwIfGatewayTicketOperationAborted } from "../../operation-context";
import { consumeIssuedGatewayTicket } from "./consume-gateway-ticket.kysely";

export type ConsumeGatewayTicketDeps = {
  db: Kysely<GatewayTicketDatabase>;
  now: () => Date;
  signal?: AbortSignal;
  ticketHasher?: TicketHasher;
};

export type ConsumeGatewayTicketContext = {
  gatewayId: GatewayId;
};

export async function consumeGatewayTicket(
  command: ConsumeGatewayTicketRequest,
  context: ConsumeGatewayTicketContext,
  deps: ConsumeGatewayTicketDeps,
): Promise<ConsumeGatewayTicketResponse> {
  assertGatewayId(context.gatewayId);
  throwIfGatewayTicketOperationAborted(deps.signal);

  if (command.ticket.trim().length === 0) {
    return {
      status: "rejected",
      reason: "invalid_or_expired",
    };
  }

  const now = deps.now().toISOString();
  const ticketHasher = deps.ticketHasher ?? defaultTicketHasher;
  const ticketHash = await ticketHasher.hash(command.ticket);
  throwIfGatewayTicketOperationAborted(deps.signal);
  const result = await consumeIssuedGatewayTicket(deps.db, {
    ticketHash,
    gatewayId: context.gatewayId,
    now,
    consumedAt: now,
  });

  if (result.status === "rejected") {
    return {
      status: "rejected",
      reason: "invalid_or_expired",
    };
  }

  return result;
}
