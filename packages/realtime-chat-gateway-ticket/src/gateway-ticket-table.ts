import { sql, type ColumnType, type Kysely } from "kysely";

export const createGatewayTicketsTableSql = `
CREATE TABLE IF NOT EXISTS gateway_tickets (
  ticket_hash text PRIMARY KEY,
  actor_id text NOT NULL,
  assigned_gateway_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS gateway_tickets_expires_at_idx
  ON gateway_tickets (expires_at);

CREATE INDEX IF NOT EXISTS gateway_tickets_assigned_gateway_id_idx
  ON gateway_tickets (assigned_gateway_id);
`;

type TimestampColumn = ColumnType<Date, string | Date, string | Date>;
type NullableTimestampColumn = ColumnType<Date | null, string | Date | null, string | Date | null>;

export type GatewayTicketDatabase = {
  gateway_tickets: {
    ticket_hash: string;
    actor_id: string;
    assigned_gateway_id: string;
    issued_at: TimestampColumn;
    expires_at: TimestampColumn;
    consumed_at: NullableTimestampColumn;
  };
};

export async function createGatewayTicketsTable(db: Kysely<GatewayTicketDatabase>): Promise<void> {
  await sql.raw(createGatewayTicketsTableSql).execute(db);
}
