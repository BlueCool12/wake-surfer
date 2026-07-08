import type { Kysely } from "kysely";
import type { ActorId, ISODateTime } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type { GatewayTicketDatabase } from "../../gateway-ticket-table";
import type { ConsumeGatewayTicketDeps } from "./consume-gateway-ticket.usecase";

type ConsumedGatewayTicketRow = {
  actorId?: unknown;
  consumedAt?: unknown;
};

export function consumeIssuedGatewayTicketWithKysely(
  db: Kysely<GatewayTicketDatabase>,
): ConsumeGatewayTicketDeps["consumeIssuedGatewayTicket"] {
  return async (input) => {
    const row = await db
      .updateTable("gateway_tickets")
      .set({
        consumed_at: input.consumedAt,
      })
      .where("ticket_hash", "=", input.ticketHash)
      .where("assigned_gateway_id", "=", input.gatewayId)
      .where("consumed_at", "is", null)
      .where("expires_at", ">", new Date(input.now))
      .returning(["actor_id as actorId", "consumed_at as consumedAt"])
      .$castTo<ConsumedGatewayTicketRow>()
      .executeTakeFirst();

    if (!row) {
      return {
        status: "rejected",
        reason: "not_consumable",
      };
    }

    return {
      status: "consumed",
      ticket: {
        actorId: parseActorId(row.actorId),
        consumedAt: parseIsoDateTime(row.consumedAt),
      },
    };
  };
}

function parseActorId(value: unknown): ActorId {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("gateway ticket consume query returned an invalid actorId");
  }

  return value;
}

function parseIsoDateTime(value: unknown): ISODateTime {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error("gateway ticket consume query returned an invalid consumedAt");
}
