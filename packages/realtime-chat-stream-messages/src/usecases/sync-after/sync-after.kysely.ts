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

export type SyncAfterMessagesSnapshot = {
  messages: StreamMessage[];
  throughSequence: number;
};

export type SyncAfterMessagesReadResult =
  | {
      status: "success";
      snapshot: SyncAfterMessagesSnapshot;
    }
  | StreamMessagesFailure<"invalid_cursor">;

export async function readMessagesAfter<DB extends StreamMessagesDatabase>(
  db: Kysely<DB>,
  input: {
    streamId: string;
    target: StreamMessagesTarget;
    afterSequence: number;
    throughSequence?: number;
    limit: number;
  },
): Promise<SyncAfterMessagesReadResult> {
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
      const throughSequence = input.throughSequence ?? stream.headSequence;

      if (
        input.afterSequence > stream.headSequence ||
        throughSequence > stream.headSequence ||
        input.afterSequence > throughSequence
      ) {
        return createStreamMessagesFailure("invalid_cursor");
      }

      if (stream.status === "missing" || input.afterSequence === throughSequence) {
        return createSyncAfterMessagesReadSuccess([], throughSequence);
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
        .where("messages.sequence", ">", input.afterSequence)
        .where("messages.sequence", "<=", throughSequence)
        .orderBy("messages.sequence", "asc")
        .limit(queryLimit)
        .execute();
      const messages = rows.map((row) => parseStreamMessageRow(row, input));
      const expectedCount = Math.min(throughSequence - input.afterSequence, queryLimit);

      if (messages.length !== expectedCount) {
        throwSequenceGap(input.streamId, input.afterSequence + 1, messages[0]?.sequence);
      }

      assertExpectedSequenceWindow(messages, {
        expectedFirst: input.afterSequence + 1,
        expectedLast: input.afterSequence + expectedCount,
        streamId: input.streamId,
      });

      return createSyncAfterMessagesReadSuccess(messages.slice(0, input.limit), throughSequence);
    });
}

function createSyncAfterMessagesReadSuccess(
  messages: StreamMessage[],
  throughSequence: number,
): SyncAfterMessagesReadResult {
  return {
    status: "success",
    snapshot: {
      messages,
      throughSequence,
    },
  };
}
