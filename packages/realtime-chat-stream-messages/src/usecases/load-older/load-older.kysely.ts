import type { Kysely } from "kysely";

import {
  assertExpectedSequenceWindow,
  createStreamMessagesFailure,
  parseMessageStreamMetadata,
  parseStreamMessageRow,
  throwSequenceGap,
  type StreamMessage,
  type StreamMessagesFailure,
  type StreamMessagesTarget,
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
    target: StreamMessagesTarget;
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
        .executeTakeFirst();
      const stream = parseMessageStreamMetadata(streamRow, input);

      if (input.beforeSequence > stream.headSequence + 1) {
        return createStreamMessagesFailure("invalid_cursor");
      }

      if (stream.status === "missing" || input.beforeSequence === 1) {
        return createOlderMessagesReadSuccess([]);
      }

      const queryLimit = input.limit + 1;
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
          "messages.deleted_at as deletedAt",
        ])
        .where("messages.stream_id", "=", input.streamId)
        .where("messages.sequence", "<", input.beforeSequence)
        .orderBy("messages.sequence", "desc")
        .limit(queryLimit)
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

      return createOlderMessagesReadSuccess(messages.slice(-input.limit));
    });
}

function createOlderMessagesReadSuccess(messages: StreamMessage[]): OlderMessagesReadResult {
  return {
    status: "success",
    messages,
  };
}
