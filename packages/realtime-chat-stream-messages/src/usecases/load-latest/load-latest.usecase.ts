import type { Kysely } from "kysely";

import {
  assertActorId,
  assertStreamMessagesTarget,
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
import { readLatestMessagesSnapshot, type LatestMessagesSnapshot } from "./load-latest.kysely";

export type LoadLatestMessagesQuery = {
  target: StreamMessagesTarget;
};

export type LatestMessagesPage = {
  throughSequence: number;
  messages: StreamMessage[];
  nextBeforeSequence: number | null;
  hasMoreBefore: boolean;
};

export type LoadLatestMessagesResult =
  | {
      status: "success";
      page: LatestMessagesPage;
    }
  | StreamMessagesFailure<"stream_unavailable">;

export type LoadLatestMessagesDeps<DB extends StreamMessagesDatabase = StreamMessagesDatabase> = {
  db: Kysely<DB>;
  authorizeRead: MessageStreamReadAuthorizer;
};

export type LoadLatestMessages = (
  query: LoadLatestMessagesQuery,
  context: StreamMessagesQueryContext,
) => Promise<LoadLatestMessagesResult>;

export function createLoadLatestMessages<DB extends StreamMessagesDatabase>(
  deps: LoadLatestMessagesDeps<DB>,
): LoadLatestMessages {
  return (query, context) => loadLatestMessages(query, context, deps);
}

export async function loadLatestMessages<DB extends StreamMessagesDatabase>(
  query: LoadLatestMessagesQuery,
  context: StreamMessagesQueryContext,
  deps: LoadLatestMessagesDeps<DB>,
): Promise<LoadLatestMessagesResult> {
  assertStreamMessagesTarget(query.target);
  assertActorId(context.actorId);

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

  const snapshot = await readLatestMessagesSnapshot(deps.db, {
    streamId: resolvedTarget.streamId,
    target: query.target,
  });
  return createLoadLatestMessagesSuccess(snapshot);
}

function createLoadLatestMessagesSuccess(
  snapshot: LatestMessagesSnapshot,
): LoadLatestMessagesResult {
  const oldest = snapshot.messages[0];

  return {
    status: "success",
    page: {
      throughSequence: snapshot.headSequence,
      messages: snapshot.messages,
      nextBeforeSequence: oldest?.sequence ?? null,
      hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
    },
  };
}
