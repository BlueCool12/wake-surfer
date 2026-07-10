import type { Kysely } from "kysely";
import type { GatewayTicketDatabase } from "../../gateway-ticket-table";
import type { IssuedGatewayTicket } from "../../gateway-ticket";

export async function saveIssuedGatewayTicket(
  db: Kysely<GatewayTicketDatabase>,
  ticket: IssuedGatewayTicket,
): Promise<void> {
  await db
    .insertInto("gateway_tickets")
    .values({
      ticket_hash: ticket.ticketHash,
      actor_id: ticket.actorId,
      assigned_gateway_id: ticket.assignedGatewayId,
      issued_at: ticket.issuedAt,
      expires_at: ticket.expiresAt,
      consumed_at: null,
    })
    .executeTakeFirstOrThrow();
}
