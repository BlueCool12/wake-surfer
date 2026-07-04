import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type {
  GatewayTicketConsumePort,
  GatewayTicketConsumeResult
} from '@wake-surfer/realtime-chat/gateway';
import type { GatewayTicketHasher } from './ticket-hasher';

type RuntimeDatabase = Record<string, never>;

type GatewayTicketRow = {
  actor_id: string;
  workspace_id: string | null;
  consumed_at: Date | string | null;
  expires_at: Date | string;
};

export async function createPostgresGatewayTicketConsumePort(
  connectionString: string,
  ticketHasher: GatewayTicketHasher
): Promise<PostgresGatewayTicketConsumePort> {
  const db = new Kysely<RuntimeDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString
      })
    })
  });
  const adapter = new PostgresGatewayTicketConsumePort(db, ticketHasher);

  await adapter.ensureSchema();
  return adapter;
}

export class PostgresGatewayTicketConsumePort
  implements GatewayTicketConsumePort
{
  constructor(
    private readonly db: Kysely<RuntimeDatabase>,
    private readonly ticketHasher: GatewayTicketHasher
  ) {}

  async ensureSchema(): Promise<void> {
    await sql`
      create table if not exists realtime_chat_gateway_tickets (
        ticket_value_hash text primary key,
        actor_id text not null,
        workspace_id text,
        issued_at timestamptz not null,
        expires_at timestamptz not null,
        consumed_at timestamptz
      )
    `.execute(this.db);
    await sql`
      alter table realtime_chat_gateway_tickets
      add column if not exists consumed_at timestamptz
    `.execute(this.db);
  }

  async consume(ticketValue: string): Promise<GatewayTicketConsumeResult> {
    const ticketValueHash = this.ticketHasher.hash(ticketValue);
    const consumed = await sql<GatewayTicketRow>`
      update realtime_chat_gateway_tickets
      set consumed_at = now()
      where ticket_value_hash = ${ticketValueHash}
        and expires_at > now()
        and consumed_at is null
      returning actor_id, workspace_id, consumed_at, expires_at
    `.execute(this.db);
    const consumedRow = consumed.rows[0];

    if (consumedRow) {
      const consumedAt = toIsoDateTime(consumedRow.consumed_at);

      return {
        status: 'consumed',
        ticket: {
          actorId: consumedRow.actor_id,
          ...(consumedRow.workspace_id
            ? { workspaceId: consumedRow.workspace_id }
            : {}),
          ...(consumedAt ? { consumedAt } : {})
        }
      };
    }

    const existing = await sql<GatewayTicketRow>`
      select actor_id, workspace_id, consumed_at, expires_at
      from realtime_chat_gateway_tickets
      where ticket_value_hash = ${ticketValueHash}
      limit 1
    `.execute(this.db);
    const existingRow = existing.rows[0];

    if (existingRow?.consumed_at) {
      return {
        status: 'rejected',
        reason: 'GATEWAY_TICKET_ALREADY_CONSUMED'
      };
    }

    return {
      status: 'rejected',
      reason: 'GATEWAY_TICKET_INVALID_OR_EXPIRED'
    };
  }

  async destroy(): Promise<void> {
    await this.db.destroy();
  }
}

function toIsoDateTime(value: Date | string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
