import type { ColumnType, Generated } from "kysely";
import type { PersistedTextMessageContent } from "./persisted-message-content";

type DatabaseGeneratedIdColumn = ColumnType<string, never, never>;
type GeneratedTimestampColumn = ColumnType<Date, string | Date | undefined, never>;
type ReadonlyNullableTimestampColumn = ColumnType<Date | null, never, never>;
type PersistedMessageContentColumn = ColumnType<unknown, PersistedTextMessageContent, never>;

export type MessageSendDatabase = {
  message_streams: {
    stream_id: DatabaseGeneratedIdColumn;
    target_type: "channel" | "dm" | "thread";
    target_id: string;
    last_sequence: Generated<number>;
    created_at: GeneratedTimestampColumn;
  };
  messages: {
    message_id: string;
    stream_id: string;
    sequence: number;
    sender_actor_id: string;
    content: PersistedMessageContentColumn;
    created_at: GeneratedTimestampColumn;
    deleted_at: ReadonlyNullableTimestampColumn;
  };
  send_message_receipts: {
    sender_actor_id: string;
    idempotency_key: string;
    canonicalization_version: number;
    fingerprint_algorithm: string;
    fingerprint_key_id: string | null;
    request_fingerprint: Uint8Array;
    result_message_id: string;
    committed_at: GeneratedTimestampColumn;
  };
};
