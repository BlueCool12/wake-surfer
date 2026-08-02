import type { ColumnType } from "kysely";

type TimestampColumn = ColumnType<Date, string | Date, string | Date>;

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
    idempotency_key: string;
    content_text: string;
    created_at: TimestampColumn;
  };
};
