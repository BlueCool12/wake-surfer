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
    channelId: string;
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
        .$castTo<RawStreamMetadataRow>()
        .executeTakeFirst();
      const stream = parseChannelStreamMetadata(streamRow, input);
      const throughSequence = input.throughSequence ?? stream.headSequence;

      if (
        input.afterSequence > stream.headSequence ||
        throughSequence > stream.headSequence ||
        input.afterSequence > throughSequence
      ) {
        return {
          status: "failure",
          code: "invalid_cursor",
        };
      }

      if (stream.status === "missing" || input.afterSequence === throughSequence) {
        return {
          status: "success",
          snapshot: {
            messages: [],
            throughSequence,
          },
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
          "content_type as contentType",
          "content_text as contentText",
          "sent_at_client as sentAtClient",
          "created_at as createdAt",
        ])
        .where("stream_id", "=", input.streamId)
        .where("sequence", ">", input.afterSequence)
        .where("sequence", "<=", throughSequence)
        .orderBy("sequence", "asc")
        .limit(queryLimit)
        .$castTo<RawStreamMessageRow>()
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

      return {
        status: "success",
        snapshot: {
          messages: messages.slice(0, input.limit),
          throughSequence,
        },
      };
    });
}
