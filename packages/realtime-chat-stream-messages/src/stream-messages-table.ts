import type { PersistedTextMessageContent } from "@wake-surfer/realtime-chat-message-send/persisted-message-content";
import type { ColumnType, Generated } from "kysely";

type DatabaseGeneratedIdColumn = ColumnType<string, never, never>;
type GeneratedTimestampColumn = ColumnType<Date, string | Date | undefined, never>;
type PersistedMessageContentColumn = ColumnType<unknown, PersistedTextMessageContent, never>;

export type StreamMessagesDatabase = {
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
  };
};
