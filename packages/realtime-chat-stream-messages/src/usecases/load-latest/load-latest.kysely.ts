import type { Kysely } from "kysely";

import {
  assertExpectedSequenceWindow,
  MAX_LATEST_MESSAGES_QUERY_COUNT,
  parseChannelStreamMetadata,
  parseStreamMessageRow,
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
        .innerJoin("message_streams", "message_streams.stream_id", "messages.stream_id")
        .select([
          "messages.message_id as messageId",
          "messages.stream_id as streamId",
          "messages.sequence",
          "messages.sender_actor_id as senderActorId",
          "message_streams.target_type as targetType",
          "message_streams.target_id as targetId",
          "messages.content",
          "messages.created_at as createdAt",
        ])
        .where("messages.stream_id", "=", input.streamId)
        .where("messages.sequence", "<=", stream.headSequence)
        .orderBy("messages.sequence", "desc")
        .limit(LATEST_QUERY_ROW_LIMIT)
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
