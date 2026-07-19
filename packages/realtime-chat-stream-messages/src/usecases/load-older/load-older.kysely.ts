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

export async function readOlderMessages<DB extends StreamMessagesDatabase>(
  db: Kysely<DB>,
  input: {
    streamId: string;
    channelId: string;
    beforeSequence: number;
    limit: number;
  },
): Promise<PublicMessage[]> {
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

      if (input.beforeSequence > headSequence + 1) {
        throw new StreamMessagesDomainError("invalid_cursor");
      }

      if (stream === undefined || input.beforeSequence === 1) {
        return [];
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
        .where("sequence", "<", input.beforeSequence)
        .orderBy("sequence", "desc")
        .limit(queryLimit)
        .$castTo<StreamMessageRow>()
        .execute();
      const descendingMessages = rows.map(parseStreamMessageRow);
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

      return messages.slice(-input.limit);
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
