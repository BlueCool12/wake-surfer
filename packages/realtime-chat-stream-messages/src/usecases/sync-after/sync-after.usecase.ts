import type { Kysely } from "kysely";

import {
  assertAfterSequence,
  assertActorId,
  assertStreamMessagesTarget,
  assertQueryPageSize,
  assertThroughSequence,
  authorizeMessageStreamRead,
  createStreamMessagesFailure,
  type MessageStreamReadAuthorizer,
  type StreamMessage,
  type StreamMessagesFailure,
  type StreamMessagesQueryContext,
  type StreamMessagesTarget,
} from "../../stream-messages";
import type { StreamMessagesDatabase } from "../../stream-messages-table";
import { resolveMessageStreamReadTarget } from "../../resolve-read-target.kysely";
import { readMessagesAfter, type SyncAfterMessagesSnapshot } from "./sync-after.kysely";

export type SyncAfterMessagesQuery = {
  target: StreamMessagesTarget;
  afterSequence: number;
  throughSequence?: number;
  limit: number;
};

export type SyncAfterMessagesPage = {
  afterSequence: number;
  throughSequence: number;
  messages: StreamMessage[];
  nextAfterSequence: number;
  hasMoreAfter: boolean;
};

export type SyncAfterMessagesResult =
  | {
      status: "success";
      page: SyncAfterMessagesPage;
    }
  | StreamMessagesFailure<"stream_unavailable" | "invalid_cursor">;

export type SyncAfterMessagesDeps<DB extends StreamMessagesDatabase = StreamMessagesDatabase> = {
  db: Kysely<DB>;
  authorizeRead: MessageStreamReadAuthorizer;
};

export type SyncAfterMessages = (
  query: SyncAfterMessagesQuery,
  context: StreamMessagesQueryContext,
) => Promise<SyncAfterMessagesResult>;

export function createSyncAfterMessages<DB extends StreamMessagesDatabase>(
  deps: SyncAfterMessagesDeps<DB>,
): SyncAfterMessages {
  return (query, context) => syncAfterMessages(query, context, deps);
}

export async function syncAfterMessages<DB extends StreamMessagesDatabase>(
  query: SyncAfterMessagesQuery,
  context: StreamMessagesQueryContext,
  deps: SyncAfterMessagesDeps<DB>,
): Promise<SyncAfterMessagesResult> {
  assertStreamMessagesTarget(query.target);
  assertAfterSequence(query.afterSequence);
  assertThroughSequence(query.throughSequence);
  assertQueryPageSize(query.limit);
  assertActorId(context.actorId);

  if (query.throughSequence !== undefined && query.afterSequence > query.throughSequence) {
    throw new TypeError("afterSequence는 throughSequence보다 클 수 없습니다.");
  }

  const resolvedTarget = await resolveMessageStreamReadTarget(deps.db, query.target);

  if (resolvedTarget.status === "unavailable") {
    return createStreamMessagesFailure("stream_unavailable");
  }

  const authorization = await authorizeMessageStreamRead(
    deps.authorizeRead,
    context.actorId,
    resolvedTarget.authorizationTarget,
  );

  if (authorization.status === "denied") {
    return createStreamMessagesFailure("stream_unavailable");
  }

  const result = await readMessagesAfter(deps.db, {
    streamId: resolvedTarget.streamId,
    target: query.target,
    afterSequence: query.afterSequence,
    ...(query.throughSequence === undefined ? {} : { throughSequence: query.throughSequence }),
    limit: query.limit,
  });

  if (result.status === "failure") {
    return result;
  }

  return createSyncAfterMessagesSuccess(query.afterSequence, result.snapshot);
}

function createSyncAfterMessagesSuccess(
  afterSequence: number,
  snapshot: SyncAfterMessagesSnapshot,
): SyncAfterMessagesResult {
  const newest = snapshot.messages.at(-1);
  const nextAfterSequence = newest?.sequence ?? snapshot.throughSequence;

  return {
    status: "success",
    page: {
      afterSequence,
      throughSequence: snapshot.throughSequence,
      messages: snapshot.messages,
      nextAfterSequence,
      hasMoreAfter: nextAfterSequence < snapshot.throughSequence,
    },
  };
}
