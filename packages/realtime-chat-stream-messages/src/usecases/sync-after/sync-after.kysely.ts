import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";

import { StreamMessagesDataIntegrityError, StreamMessagesDomainError } from "../../errors.js";
import {
  assertExpectedSequenceWindow,
  parseStreamMessageRow,
  throwSequenceGap,
  type StreamMessageRow,
} from "../../stream-messages.js";
import type { StreamMessagesDatabase } from "../../stream-messages-table.js";

export type SyncAfterMessagesSnapshot = {
  messages: PublicMessage[];
  throughSequence: number;
};

export async function readMessagesAfter<DB extends StreamMessagesDatabase>(
  db: Kysely<DB>,
  input: {
    streamId: string;
    channelId: string;
    afterSequence: number;
    throughSequence?: number;
    limit: number;
  },
): Promise<SyncAfterMessagesSnapshot> {
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
      const headSequence = parseHeadSequence(stream, input);
      const throughSequence = input.throughSequence ?? headSequence;

      if (
        input.afterSequence > headSequence ||
        throughSequence > headSequence ||
        input.afterSequence > throughSequence
      ) {
        throw new StreamMessagesDomainError("invalid_cursor");
      }

      if (stream === undefined || input.afterSequence === throughSequence) {
        return {
          messages: [],
          throughSequence,
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
        .$castTo<StreamMessageRow>()
        .execute();
      const messages = rows.map(parseStreamMessageRow);
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
        messages: messages.slice(0, input.limit),
        throughSequence,
      };
    });
}

function parseHeadSequence(
  stream: { targetType: unknown; targetId: unknown; headSequence: unknown } | undefined,
  input: { streamId: string; channelId: string },
): number {
  if (stream === undefined) {
    return 0;
  }

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

  return stream.headSequence as number;
}
