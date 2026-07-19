import type { ColumnType } from "kysely";

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
