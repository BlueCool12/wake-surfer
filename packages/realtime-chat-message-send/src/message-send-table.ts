import { sql, type ColumnType, type Kysely } from "kysely";

export const createMessageSendTablesSql = `
CREATE TABLE IF NOT EXISTS message_streams (
  stream_id text PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  last_sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS message_streams_target_idx
  ON message_streams (target_type, target_id);

CREATE TABLE IF NOT EXISTS messages (
  message_id text PRIMARY KEY,
  stream_id text NOT NULL REFERENCES message_streams(stream_id),
  sequence integer NOT NULL,
  sender_actor_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  client_message_id text NOT NULL,
  content_type text NOT NULL CHECK (content_type = 'text'),
  content_text text NOT NULL,
  sent_at_client timestamptz NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (stream_id, sequence),
  UNIQUE (sender_actor_id, stream_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS messages_stream_sequence_idx
  ON messages (stream_id, sequence);
`;

type TimestampColumn = ColumnType<Date, string | Date, string | Date>;
type NullableTimestampColumn = ColumnType<Date | null, string | Date | null, string | Date | null>;

export type MessageSendDatabase = {
  message_streams: {
    stream_id: string;
    target_type: string;
    target_id: string;
    last_sequence: number;
    created_at: TimestampColumn;
  };
  messages: {
    message_id: string;
    stream_id: string;
    sequence: number;
    sender_actor_id: string;
    target_type: string;
    target_id: string;
    client_message_id: string;
    content_type: string;
    content_text: string;
    sent_at_client: NullableTimestampColumn;
    created_at: TimestampColumn;
  };
};

export async function createMessageSendTables(db: Kysely<MessageSendDatabase>): Promise<void> {
  await sql.raw(createMessageSendTablesSql).execute(db);
}
