import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";

import {
  authorizeChannelRead,
  getChannelStreamId,
  type ChannelReadAuthorizer,
  type StreamMessagesQueryContext,
} from "../../stream-messages.js";
import type { StreamMessagesDatabase } from "../../stream-messages-table.js";
import { readOlderMessages } from "./load-older.kysely.js";

export type LoadOlderMessagesQuery = {
  channelId: string;
  beforeSequence: number;
  limit: number;
};

export type OlderMessagesPage = {
  streamId: string;
  beforeSequence: number;
  messages: PublicMessage[];
  nextBeforeSequence: number | null;
  hasMoreBefore: boolean;
};

export type LoadOlderMessagesDeps<DB extends StreamMessagesDatabase = StreamMessagesDatabase> = {
  db: Kysely<DB>;
  authorizeRead: ChannelReadAuthorizer;
};

export async function loadOlderMessages<DB extends StreamMessagesDatabase>(
  query: LoadOlderMessagesQuery,
  context: StreamMessagesQueryContext,
  deps: LoadOlderMessagesDeps<DB>,
): Promise<OlderMessagesPage> {
  await authorizeChannelRead(deps.authorizeRead, context.actorId, query.channelId);
  const streamId = getChannelStreamId(query.channelId);
  const messages = await readOlderMessages(deps.db, {
    streamId,
    channelId: query.channelId,
    beforeSequence: query.beforeSequence,
    limit: query.limit,
  });
  const oldest = messages[0];

  return {
    streamId,
    beforeSequence: query.beforeSequence,
    messages,
    nextBeforeSequence: oldest?.sequence ?? null,
    hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
  };
}
