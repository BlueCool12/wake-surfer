import type { Kysely } from "kysely";
import type { GatewayTicketDatabase } from "../../gateway-ticket-table";
import type { IssueGatewayTicketDeps } from "./issue-gateway-ticket.usecase";

export function saveIssuedGatewayTicketWithKysely(
  db: Kysely<GatewayTicketDatabase>,
): IssueGatewayTicketDeps["saveIssuedGatewayTicket"] {
  return async (ticket) => {
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
  };
}
