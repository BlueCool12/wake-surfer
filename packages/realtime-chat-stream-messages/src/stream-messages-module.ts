import type { Kysely } from "kysely";

import type { ChannelReadAuthorizer, StreamMessagesQueryContext } from "./stream-messages.js";
import type { StreamMessagesDatabase } from "./stream-messages-table.js";
import {
  loadLatestMessages,
  type LatestMessagesPage,
  type LoadLatestMessagesQuery,
} from "./usecases/load-latest/load-latest.usecase.js";
import {
  loadOlderMessages,
  type LoadOlderMessagesQuery,
  type OlderMessagesPage,
} from "./usecases/load-older/load-older.usecase.js";
import {
  syncAfterMessages,
  type SyncAfterMessagesPage,
  type SyncAfterMessagesQuery,
} from "./usecases/sync-after/sync-after.usecase.js";

export type StreamMessagesModule = {
  loadLatest: (
    query: LoadLatestMessagesQuery,
    context: StreamMessagesQueryContext,
  ) => Promise<LatestMessagesPage>;
  loadOlder: (
    query: LoadOlderMessagesQuery,
    context: StreamMessagesQueryContext,
  ) => Promise<OlderMessagesPage>;
  syncAfter: (
    query: SyncAfterMessagesQuery,
    context: StreamMessagesQueryContext,
  ) => Promise<SyncAfterMessagesPage>;
};

export type CreateStreamMessagesModuleConfig<
  DB extends StreamMessagesDatabase = StreamMessagesDatabase,
> = {
  db: Kysely<DB>;
  authorizeRead: ChannelReadAuthorizer;
};

export function createStreamMessagesModule<DB extends StreamMessagesDatabase>(
  config: CreateStreamMessagesModuleConfig<DB>,
): StreamMessagesModule {
  return {
    loadLatest(query, context) {
      return loadLatestMessages(query, context, config);
    },
    loadOlder(query, context) {
      return loadOlderMessages(query, context, config);
    },
    syncAfter(query, context) {
      return syncAfterMessages(query, context, config);
    },
  };
}
