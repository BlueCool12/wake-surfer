import type { Kysely } from "kysely";
import type { ActorId, ISODateTime } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import type {
  GatewayTicketConsumptionInput,
  GatewayTicketConsumptionResult,
} from "../../gateway-ticket";
import type { GatewayTicketDatabase } from "../../gateway-ticket-table";

type ConsumedGatewayTicketRow = {
  actorId?: unknown;
  consumedAt?: unknown;
};

export async function consumeIssuedGatewayTicket(
  db: Kysely<GatewayTicketDatabase>,
  input: GatewayTicketConsumptionInput,
): Promise<GatewayTicketConsumptionResult> {
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
}

function parseActorId(value: unknown): ActorId {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("게이트웨이 티켓 소비 쿼리가 올바르지 않은 actorId를 반환했습니다.");
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

  throw new Error("게이트웨이 티켓 소비 쿼리가 올바르지 않은 consumedAt을 반환했습니다.");
}
