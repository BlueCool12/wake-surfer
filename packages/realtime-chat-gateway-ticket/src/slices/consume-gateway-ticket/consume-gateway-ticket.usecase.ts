import type {
  ConsumeGatewayTicketRequest,
  ConsumeGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import { defaultTicketHasher } from "../../gateway-ticket";
import type {
  GatewayTicketConsumptionInput,
  GatewayTicketConsumptionResult,
  TicketHasher,
} from "../../gateway-ticket";

export type ConsumeGatewayTicketDeps = {
  now: () => Date;
  consumeIssuedGatewayTicket: (
    input: GatewayTicketConsumptionInput,
  ) => Promise<GatewayTicketConsumptionResult>;
  ticketHasher?: TicketHasher;
};

export async function consumeGatewayTicket(
  command: ConsumeGatewayTicketRequest,
  deps: ConsumeGatewayTicketDeps,
): Promise<ConsumeGatewayTicketResponse> {
  const now = deps.now().toISOString();
  const ticketHasher = deps.ticketHasher ?? defaultTicketHasher;
  const ticketHash = await ticketHasher.hash(command.ticket);
  const result = await deps.consumeIssuedGatewayTicket({
    ticketHash,
    gatewayId: command.gatewayId,
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
