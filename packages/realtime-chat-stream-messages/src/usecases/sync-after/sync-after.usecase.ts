import type { Kysely } from "kysely";

import {
  assertAfterSequence,
  assertChannelId,
  assertQueryPageSize,
  assertThroughSequence,
  authorizeChannelRead,
  getChannelStreamId,
  type ChannelReadAuthorizer,
  type StreamMessage,
  type StreamMessagesFailure,
  type StreamMessagesQueryContext,
} from "../../stream-messages";
import type { StreamMessagesDatabase } from "../../stream-messages-table";
import { readMessagesAfter } from "./sync-after.kysely";

export type SyncAfterMessagesQuery = {
  channelId: string;
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
  authorizeRead: ChannelReadAuthorizer;
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
  assertChannelId(query.channelId);
  assertAfterSequence(query.afterSequence);
  assertThroughSequence(query.throughSequence);
  assertQueryPageSize(query.limit);

  if (query.throughSequence !== undefined && query.afterSequence > query.throughSequence) {
    throw new TypeError("afterSequence는 throughSequence보다 클 수 없습니다.");
  }

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
  const result = await readMessagesAfter(deps.db, {
    streamId,
    channelId: query.channelId,
    afterSequence: query.afterSequence,
    ...(query.throughSequence === undefined ? {} : { throughSequence: query.throughSequence }),
    limit: query.limit,
  });

  if (result.status === "failure") {
    return result;
  }

  const newest = result.snapshot.messages.at(-1);
  const nextAfterSequence = newest?.sequence ?? result.snapshot.throughSequence;

  return {
    status: "success",
    page: {
      afterSequence: query.afterSequence,
      throughSequence: result.snapshot.throughSequence,
      messages: result.snapshot.messages,
      nextAfterSequence,
      hasMoreAfter: nextAfterSequence < result.snapshot.throughSequence,
    },
  };
}
