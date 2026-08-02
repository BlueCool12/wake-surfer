import type { Kysely } from "kysely";

import {
  assertExpectedSequenceWindow,
  parseChannelStreamMetadata,
  parseStreamMessageRow,
  throwSequenceGap,
  type RawStreamMessageRow,
  type RawStreamMetadataRow,
  type StreamMessage,
  type StreamMessagesFailure,
} from "../../stream-messages";
import type { StreamMessagesDatabase } from "../../stream-messages-table";

export type OlderMessagesReadResult =
  | {
      status: "success";
      messages: StreamMessage[];
    }
  | StreamMessagesFailure<"invalid_cursor">;

export async function readOlderMessages<DB extends StreamMessagesDatabase>(
  db: Kysely<DB>,
  input: {
    streamId: string;
    channelId: string;
    beforeSequence: number;
    limit: number;
  },
): Promise<OlderMessagesReadResult> {
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

      if (input.beforeSequence > stream.headSequence + 1) {
        return {
          status: "failure",
          code: "invalid_cursor",
        };
      }

      if (stream.status === "missing" || input.beforeSequence === 1) {
        return {
          status: "success",
          messages: [],
        };
      }

      const queryLimit = input.limit + 1;
      const rows = await transaction
        .selectFrom("messages")
        .select([
          "message_id as messageId",
          "stream_id as streamId",
          "sequence",
          "sender_actor_id as senderActorId",
          "target_type as targetType",
          "target_id as targetId",
          "content_text as contentText",
          "created_at as createdAt",
        ])
        .where("stream_id", "=", input.streamId)
        .where("sequence", "<", input.beforeSequence)
        .orderBy("sequence", "desc")
        .limit(queryLimit)
        .$castTo<RawStreamMessageRow>()
        .execute();
      const descendingMessages = rows.map((row) => parseStreamMessageRow(row, input));
      const expectedCount = Math.min(input.beforeSequence - 1, queryLimit);

      if (descendingMessages.length !== expectedCount) {
        throwSequenceGap(input.streamId, input.beforeSequence - 1, descendingMessages[0]?.sequence);
      }

      const messages = descendingMessages.reverse();
      assertExpectedSequenceWindow(messages, {
        expectedFirst: input.beforeSequence - expectedCount,
        expectedLast: input.beforeSequence - 1,
        streamId: input.streamId,
      });

      return {
        status: "success",
        messages: messages.slice(-input.limit),
      };
    });
}
