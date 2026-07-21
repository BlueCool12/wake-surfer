import type { Kysely } from "kysely";

import {
  assertChannelId,
  authorizeChannelRead,
  getChannelStreamId,
  type ChannelReadAuthorizer,
  type StreamMessage,
  type StreamMessagesFailure,
  type StreamMessagesQueryContext,
} from "../../stream-messages";
import type { StreamMessagesDatabase } from "../../stream-messages-table";
import { readLatestMessagesSnapshot } from "./load-latest.kysely";

export type LoadLatestMessagesQuery = {
  channelId: string;
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
  authorizeRead: ChannelReadAuthorizer;
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
  assertChannelId(query.channelId);
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
  const snapshot = await readLatestMessagesSnapshot(deps.db, {
    streamId,
    channelId: query.channelId,
  });
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
