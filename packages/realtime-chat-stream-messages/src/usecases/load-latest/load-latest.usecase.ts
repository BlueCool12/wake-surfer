import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";

import {
  assertChannelId,
  authorizeChannelRead,
  getChannelStreamId,
  type ChannelReadAuthorizer,
  type StreamMessagesQueryContext,
} from "../../stream-messages.js";
import type { StreamMessagesDatabase } from "../../stream-messages-table.js";
import { readLatestMessagesSnapshot } from "./load-latest.kysely.js";

export type LoadLatestMessagesQuery = {
  channelId: string;
};

export type LatestMessagesPage = {
  streamId: string;
  throughSequence: number;
  messages: PublicMessage[];
  nextBeforeSequence: number | null;
  hasMoreBefore: boolean;
};

export type LoadLatestMessagesDeps<DB extends StreamMessagesDatabase = StreamMessagesDatabase> = {
  db: Kysely<DB>;
  authorizeRead: ChannelReadAuthorizer;
};

export type LoadLatestMessages = (
  query: LoadLatestMessagesQuery,
  context: StreamMessagesQueryContext,
) => Promise<LatestMessagesPage>;

export function createLoadLatestMessages<DB extends StreamMessagesDatabase>(
  deps: LoadLatestMessagesDeps<DB>,
): LoadLatestMessages {
  return (query, context) => loadLatestMessages(query, context, deps);
}

export async function loadLatestMessages<DB extends StreamMessagesDatabase>(
  query: LoadLatestMessagesQuery,
  context: StreamMessagesQueryContext,
  deps: LoadLatestMessagesDeps<DB>,
): Promise<LatestMessagesPage> {
  assertChannelId(query.channelId);
  await authorizeChannelRead(deps.authorizeRead, context.actorId, query.channelId);
  const streamId = getChannelStreamId(query.channelId);
  const snapshot = await readLatestMessagesSnapshot(deps.db, {
    streamId,
    channelId: query.channelId,
  });
  const oldest = snapshot.messages[0];

  return {
    streamId,
    throughSequence: snapshot.headSequence,
    messages: snapshot.messages,
    nextBeforeSequence: oldest?.sequence ?? null,
    hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
  };
}
