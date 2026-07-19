import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type { Kysely } from "kysely";

import {
  assertAfterSequence,
  assertChannelId,
  assertQueryPageSize,
  assertThroughSequence,
  authorizeChannelRead,
  getChannelStreamId,
  type ChannelReadAuthorizer,
  type StreamMessagesQueryContext,
} from "../../stream-messages.js";
import type { StreamMessagesDatabase } from "../../stream-messages-table.js";
import { readMessagesAfter } from "./sync-after.kysely.js";

export type SyncAfterMessagesQuery = {
  channelId: string;
  afterSequence: number;
  throughSequence?: number;
  limit: number;
};

export type SyncAfterMessagesPage = {
  streamId: string;
  afterSequence: number;
  throughSequence: number;
  messages: PublicMessage[];
  nextAfterSequence: number;
  hasMoreAfter: boolean;
};

export type SyncAfterMessagesDeps<DB extends StreamMessagesDatabase = StreamMessagesDatabase> = {
  db: Kysely<DB>;
  authorizeRead: ChannelReadAuthorizer;
};

export type SyncAfterMessages = (
  query: SyncAfterMessagesQuery,
  context: StreamMessagesQueryContext,
) => Promise<SyncAfterMessagesPage>;

export function createSyncAfterMessages<DB extends StreamMessagesDatabase>(
  deps: SyncAfterMessagesDeps<DB>,
): SyncAfterMessages {
  return (query, context) => syncAfterMessages(query, context, deps);
}

export async function syncAfterMessages<DB extends StreamMessagesDatabase>(
  query: SyncAfterMessagesQuery,
  context: StreamMessagesQueryContext,
  deps: SyncAfterMessagesDeps<DB>,
): Promise<SyncAfterMessagesPage> {
  assertChannelId(query.channelId);
  assertAfterSequence(query.afterSequence);
  assertThroughSequence(query.throughSequence);
  assertQueryPageSize(query.limit);

  if (query.throughSequence !== undefined && query.afterSequence > query.throughSequence) {
    throw new TypeError("afterSequence는 throughSequence보다 클 수 없습니다.");
  }

  await authorizeChannelRead(deps.authorizeRead, context.actorId, query.channelId);
  const streamId = getChannelStreamId(query.channelId);
  const snapshot = await readMessagesAfter(deps.db, {
    streamId,
    channelId: query.channelId,
    afterSequence: query.afterSequence,
    ...(query.throughSequence === undefined ? {} : { throughSequence: query.throughSequence }),
    limit: query.limit,
  });
  const newest = snapshot.messages.at(-1);
  const nextAfterSequence = newest?.sequence ?? snapshot.throughSequence;

  return {
    streamId,
    afterSequence: query.afterSequence,
    throughSequence: snapshot.throughSequence,
    messages: snapshot.messages,
    nextAfterSequence,
    hasMoreAfter: nextAfterSequence < snapshot.throughSequence,
  };
}
