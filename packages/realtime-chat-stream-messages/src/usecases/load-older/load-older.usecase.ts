import type { Kysely } from "kysely";

import {
  assertBeforeSequence,
  assertChannelId,
  assertQueryPageSize,
  authorizeChannelRead,
  getChannelStreamId,
  type ChannelReadAuthorizer,
  type StreamMessage,
  type StreamMessagesFailure,
  type StreamMessagesQueryContext,
} from "../../stream-messages";
import type { StreamMessagesDatabase } from "../../stream-messages-table";
import { readOlderMessages } from "./load-older.kysely";

export type LoadOlderMessagesQuery = {
  channelId: string;
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
  authorizeRead: ChannelReadAuthorizer;
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
  assertChannelId(query.channelId);
  assertBeforeSequence(query.beforeSequence);
  assertQueryPageSize(query.limit);
  const authorization = await authorizeChannelRead(
    deps.authorizeRead,
    context.actorId,
    query.channelId,
  );

  if (authorization.status === "denied") {
    return {
      status: "failure",
      code: "stream_unavailable",
    };
  }

  const streamId = getChannelStreamId(query.channelId);
  const result = await readOlderMessages(deps.db, {
    streamId,
    channelId: query.channelId,
    beforeSequence: query.beforeSequence,
    limit: query.limit,
  });

  if (result.status === "failure") {
    return result;
  }

  const oldest = result.messages[0];

  return {
    status: "success",
    page: {
      beforeSequence: query.beforeSequence,
      messages: result.messages,
      nextBeforeSequence: oldest?.sequence ?? null,
      hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
    },
  };
}
