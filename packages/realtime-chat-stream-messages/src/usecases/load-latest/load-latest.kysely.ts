import type { Kysely } from "kysely";

import { StreamMessagesDataIntegrityError } from "../../errors.js";
import {
  assertExpectedSequenceWindow,
  MAX_LATEST_MESSAGES_QUERY_COUNT,
  parseStreamMessageRow,
  type StreamMessageRow,
} from "../../stream-messages.js";
import type { StreamMessagesDatabase } from "../../stream-messages-table.js";

export type LatestMessagesSnapshot = {
  headSequence: number;
  messages: ReturnType<typeof parseStreamMessageRow>[];
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
      const stream = await transaction
        .selectFrom("message_streams")
        .select([
          "target_type as targetType",
          "target_id as targetId",
          "last_sequence as headSequence",
        ])
        .where("stream_id", "=", input.streamId)
        .$castTo<{ targetType: unknown; targetId: unknown; headSequence: unknown }>()
        .executeTakeFirst();

      if (stream === undefined) {
        return {
          headSequence: 0,
          messages: [],
        };
      }

      assertStreamMetadata(stream, input);

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
        .where("sequence", "<=", stream.headSequence as number)
        .orderBy("sequence", "desc")
        .limit(LATEST_QUERY_ROW_LIMIT)
        .$castTo<StreamMessageRow>()
        .execute();
      const messages = rows.map(parseStreamMessageRow).reverse();
      const headSequence = stream.headSequence as number;

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

function assertStreamMetadata(
  stream: { targetType: unknown; targetId: unknown; headSequence: unknown },
  input: { streamId: string; channelId: string },
): asserts stream is { targetType: "channel"; targetId: string; headSequence: number } {
  if (stream.targetType !== "channel" || stream.targetId !== input.channelId) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", {
      streamId: input.streamId,
      expectedTargetType: "channel",
      expectedTargetId: input.channelId,
      actualTargetType: String(stream.targetType),
      actualTargetId: String(stream.targetId),
    });
  }

  if (!Number.isSafeInteger(stream.headSequence) || (stream.headSequence as number) < 0) {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", {
      streamId: input.streamId,
      field: "last_sequence",
    });
  }
}
