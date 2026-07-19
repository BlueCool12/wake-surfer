import type { ColumnType } from "kysely";

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
