import type { Kysely } from "kysely";

import {
  assertExpectedSequenceWindow,
  MAX_LATEST_MESSAGES_QUERY_COUNT,
  parseChannelStreamMetadata,
  parseStreamMessageRow,
  type RawStreamMessageRow,
  type RawStreamMetadataRow,
  type StreamMessage,
} from "../../stream-messages";
import type { StreamMessagesDatabase } from "../../stream-messages-table";

export type LatestMessagesSnapshot = {
  headSequence: number;
  messages: StreamMessage[];
};

const LATEST_QUERY_ROW_LIMIT = MAX_LATEST_MESSAGES_QUERY_COUNT + 1;

export async function readLatestMessagesSnapshot<DB extends StreamMessagesDatabase>(
  db: Kysely<DB>,
  input: {
    streamId: string;
    channelId: string;
  },
): Promise<LatestMessagesSnapshot> {
  const readDb = db as Kysely<StreamMessagesDatabase>;

  return readDb
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (transaction) => {
      const streamRow = await transaction
        .selectFrom("message_streams")
        .select([
          "target_type as targetType",
          "target_id as targetId",
          "last_sequence as headSequence",
        ])
        .where("stream_id", "=", input.streamId)
        .$castTo<RawStreamMetadataRow>()
        .executeTakeFirst();
      const stream = parseChannelStreamMetadata(streamRow, input);

      if (stream.status === "missing") {
        return {
          headSequence: 0,
          messages: [],
        };
      }

      const rows = await transaction
        .selectFrom("messages")
        .select([
          "message_id as messageId",
          "stream_id as streamId",
          "sequence",
          "sender_actor_id as senderActorId",
          "target_type as targetType",
          "target_id as targetId",
          "content_type as contentType",
          "content_text as contentText",
          "sent_at_client as sentAtClient",
          "created_at as createdAt",
        ])
        .where("stream_id", "=", input.streamId)
        .where("sequence", "<=", stream.headSequence)
        .orderBy("sequence", "desc")
        .limit(LATEST_QUERY_ROW_LIMIT)
        .$castTo<RawStreamMessageRow>()
        .execute();
      const messages = rows.map((row) => parseStreamMessageRow(row, input)).reverse();
      const headSequence = stream.headSequence;

      assertExpectedSequenceWindow(messages, {
        expectedFirst: Math.max(1, headSequence - LATEST_QUERY_ROW_LIMIT + 1),
        expectedLast: headSequence,
        streamId: input.streamId,
      });

      return {
        headSequence,
        messages: messages.slice(-MAX_LATEST_MESSAGES_QUERY_COUNT),
      };
    });
}
