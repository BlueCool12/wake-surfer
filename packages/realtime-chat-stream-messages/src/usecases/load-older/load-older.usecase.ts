import type { Kysely } from "kysely";

import {
  assertBeforeSequence,
  assertActorId,
  assertStreamMessagesTarget,
  assertQueryPageSize,
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
import { readOlderMessages } from "./load-older.kysely";

export type LoadOlderMessagesQuery = {
  target: StreamMessagesTarget;
  beforeSequence: number;
  limit: number;
};

export type OlderMessagesPage = {
  beforeSequence: number;
  messages: StreamMessage[];
  nextBeforeSequence: number | null;
  hasMoreBefore: boolean;
};

export type LoadOlderMessagesResult =
  | {
      status: "success";
      page: OlderMessagesPage;
    }
  | StreamMessagesFailure<"stream_unavailable" | "invalid_cursor">;

export type LoadOlderMessagesDeps<DB extends StreamMessagesDatabase = StreamMessagesDatabase> = {
  db: Kysely<DB>;
  authorizeRead: MessageStreamReadAuthorizer;
};

export type LoadOlderMessages = (
  query: LoadOlderMessagesQuery,
  context: StreamMessagesQueryContext,
) => Promise<LoadOlderMessagesResult>;

export function createLoadOlderMessages<DB extends StreamMessagesDatabase>(
  deps: LoadOlderMessagesDeps<DB>,
): LoadOlderMessages {
  return (query, context) => loadOlderMessages(query, context, deps);
}

export async function loadOlderMessages<DB extends StreamMessagesDatabase>(
  query: LoadOlderMessagesQuery,
  context: StreamMessagesQueryContext,
  deps: LoadOlderMessagesDeps<DB>,
): Promise<LoadOlderMessagesResult> {
  assertStreamMessagesTarget(query.target);
  assertBeforeSequence(query.beforeSequence);
  assertQueryPageSize(query.limit);
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

  const result = await readOlderMessages(deps.db, {
    streamId: resolvedTarget.streamId,
    target: query.target,
    beforeSequence: query.beforeSequence,
    limit: query.limit,
  });

  if (result.status === "failure") {
    return result;
  }

  return createLoadOlderMessagesSuccess(query.beforeSequence, result.messages);
}

function createLoadOlderMessagesSuccess(
  beforeSequence: number,
  messages: StreamMessage[],
): LoadOlderMessagesResult {
  const oldest = messages[0];

  return {
    status: "success",
    page: {
      beforeSequence,
      messages,
      nextBeforeSequence: oldest?.sequence ?? null,
      hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
    },
  };
}
