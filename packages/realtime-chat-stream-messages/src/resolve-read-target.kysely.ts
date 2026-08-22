import type { Kysely } from "kysely";

import { StreamMessagesDataIntegrityError } from "./errors";
import { getCanonicalStreamMessagesId, type StreamMessagesTarget } from "./stream-messages";
import type { StreamMessagesDatabase } from "./stream-messages-table";

export type ResolvedMessageStreamReadTarget =
  | {
      status: "resolved";
      streamId: string;
      authorizationTarget: Exclude<StreamMessagesTarget, { type: "thread" }>;
    }
  | {
      status: "unavailable";
    };

export async function resolveMessageStreamReadTarget<DB extends StreamMessagesDatabase>(
  db: Kysely<DB>,
  target: StreamMessagesTarget,
): Promise<ResolvedMessageStreamReadTarget> {
  const streamId = getCanonicalStreamMessagesId(target);

  if (target.type !== "thread") {
    return {
      status: "resolved",
      streamId,
      authorizationTarget: target,
    };
  }

  const readDb = db as Kysely<StreamMessagesDatabase>;
  const row = await readDb
    .selectFrom("message_streams as thread_stream")
    .leftJoin("messages as root_message", "root_message.message_id", "thread_stream.target_id")
    .leftJoin(
      "message_streams as parent_stream",
      "parent_stream.stream_id",
      "root_message.stream_id",
    )
    .select([
      "thread_stream.target_type as threadTargetType",
      "thread_stream.target_id as threadTargetId",
      "root_message.message_id as rootMessageId",
      "parent_stream.target_type as parentTargetType",
      "parent_stream.target_id as parentTargetId",
    ])
    .where("thread_stream.stream_id", "=", streamId)
    .executeTakeFirst();

  if (row === undefined) {
    return {
      status: "unavailable",
    };
  }

  if (row.threadTargetType !== "thread" || row.threadTargetId !== target.threadId) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", {
      streamId,
      expectedTargetType: "thread",
      expectedTargetId: target.threadId,
      actualTargetType: String(row.threadTargetType),
      actualTargetId: String(row.threadTargetId),
    });
  }

  if (row.rootMessageId !== target.threadId) {
    throwInvalidThreadOrigin(streamId);
  }

  const parentTargetId = parseNonBlankString(row.parentTargetId);

  if (parentTargetId === undefined) {
    throwInvalidThreadOrigin(streamId);
  }

  if (row.parentTargetType === "channel") {
    return {
      status: "resolved",
      streamId,
      authorizationTarget: {
        type: "channel",
        channelId: parentTargetId,
      },
    };
  }

  if (row.parentTargetType === "dm") {
    return {
      status: "resolved",
      streamId,
      authorizationTarget: {
        type: "dm",
        dmConversationId: parentTargetId,
      },
    };
  }

  throwInvalidThreadOrigin(streamId);
}

function throwInvalidThreadOrigin(streamId: string): never {
  throw new StreamMessagesDataIntegrityError("invalid_storage_row", {
    streamId,
    field: "thread_origin",
  });
}

function parseNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    return undefined;
  }

  return value;
}
