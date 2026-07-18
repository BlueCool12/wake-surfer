import {
  getCanonicalStreamId,
  PublicMessageSchema,
  type PublicMessage,
} from "@wake-surfer/realtime-chat-message-contracts";
import type { MessageSendDatabase } from "@wake-surfer/realtime-chat-message-send/table-contract";
import {
  MAX_LATEST_STREAM_MESSAGES,
  type FinalEnvelopeMeasurer,
  type LatestStreamMessagesHttpRequest,
  type LatestStreamMessagesResponse,
  type OlderStreamMessagesHttpRequest,
  type OlderStreamMessagesResponse,
  type SyncAfterStreamMessagesRequest,
  type SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";
import type { Kysely, Transaction } from "kysely";

import { StreamMessagesDataIntegrityError, StreamMessagesDomainError } from "./errors.js";
import {
  fitNewestContiguousMessages,
  fitOldestContiguousMessages,
  type MeasuredPage,
} from "./page-policy.js";

export type ChannelReadAuthorization = { status: "allowed" } | { status: "denied" };

export type ChannelReadAuthorizer = (input: {
  actorId: string;
  channelId: string;
}) => ChannelReadAuthorization | Promise<ChannelReadAuthorization>;

export type StreamMessagesQueryContext<Response> = {
  actorId: string;
  measureFinalEnvelope: FinalEnvelopeMeasurer<Response>;
};

export type StreamMessagesModule = {
  loadLatest: (
    request: LatestStreamMessagesHttpRequest,
    context: StreamMessagesQueryContext<LatestStreamMessagesResponse>,
  ) => Promise<MeasuredPage<LatestStreamMessagesResponse>>;
  loadOlder: (
    request: OlderStreamMessagesHttpRequest,
    context: StreamMessagesQueryContext<OlderStreamMessagesResponse>,
  ) => Promise<MeasuredPage<OlderStreamMessagesResponse>>;
  syncAfter: (
    request: SyncAfterStreamMessagesRequest,
    context: StreamMessagesQueryContext<SyncAfterStreamMessagesResponse>,
  ) => Promise<MeasuredPage<SyncAfterStreamMessagesResponse>>;
};

export type CreateStreamMessagesModuleConfig<DB extends MessageSendDatabase = MessageSendDatabase> =
  {
    db: Kysely<DB>;
    authorizeRead: ChannelReadAuthorizer;
  };

type StreamMetadata = {
  headSequence: number;
};

type MessageRow = {
  messageId: unknown;
  streamId: unknown;
  sequence: unknown;
  senderActorId: unknown;
  targetType: unknown;
  targetId: unknown;
  contentType: unknown;
  contentText: unknown;
  sentAtClient: unknown;
  createdAt: unknown;
};

const LATEST_QUERY_ROW_LIMIT = MAX_LATEST_STREAM_MESSAGES + 1;

export function createStreamMessagesModule<DB extends MessageSendDatabase = MessageSendDatabase>(
  config: CreateStreamMessagesModuleConfig<DB>,
): StreamMessagesModule {
  const db = config.db as Kysely<MessageSendDatabase>;

  return {
    async loadLatest(request, context) {
      await authorizeChannelRead(config.authorizeRead, context.actorId, request.channelId);
      const streamId = getChannelStreamId(request.channelId);

      const snapshot = await executeReadSnapshot(db, async (transaction) => {
        const stream = await readStreamMetadata(transaction, streamId, request.channelId);

        if (stream === undefined) {
          return {
            headSequence: 0,
            messages: [] as PublicMessage[],
          };
        }

        const rows = await selectLatestRows(transaction, streamId, stream.headSequence);
        const messages = rows.map(parseMessageRow).reverse();
        assertExpectedSequenceWindow(messages, {
          expectedFirst: Math.max(1, stream.headSequence - LATEST_QUERY_ROW_LIMIT + 1),
          expectedLast: stream.headSequence,
          streamId,
        });

        return {
          headSequence: stream.headSequence,
          messages: messages.slice(-MAX_LATEST_STREAM_MESSAGES),
        };
      });

      return fitNewestContiguousMessages({
        messages: snapshot.messages,
        buildResponse: (messages) => {
          const oldest = messages[0];

          return {
            streamId,
            throughSequence: snapshot.headSequence,
            messages,
            nextBeforeSequence: oldest?.sequence ?? null,
            hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
          };
        },
        measureFinalEnvelope: context.measureFinalEnvelope,
      });
    },

    async loadOlder(request, context) {
      await authorizeChannelRead(config.authorizeRead, context.actorId, request.channelId);
      const streamId = getChannelStreamId(request.channelId);

      const messages = await executeReadSnapshot(db, async (transaction) => {
        const stream = await readStreamMetadata(transaction, streamId, request.channelId);
        const headSequence = stream?.headSequence ?? 0;

        if (request.beforeSequence > headSequence + 1) {
          throw new StreamMessagesDomainError("invalid_cursor");
        }

        if (stream === undefined || request.beforeSequence === 1) {
          return [] as PublicMessage[];
        }

        const queryLimit = request.limit + 1;
        const rows = await selectOlderRows(
          transaction,
          streamId,
          request.beforeSequence,
          queryLimit,
        );
        const descendingMessages = rows.map(parseMessageRow);
        const expectedCount = Math.min(request.beforeSequence - 1, queryLimit);

        if (descendingMessages.length !== expectedCount) {
          throwSequenceGap(streamId, request.beforeSequence - 1, descendingMessages[0]?.sequence);
        }

        const messagesInAscendingOrder = descendingMessages.reverse();
        assertExpectedSequenceWindow(messagesInAscendingOrder, {
          expectedFirst: request.beforeSequence - expectedCount,
          expectedLast: request.beforeSequence - 1,
          streamId,
        });

        return messagesInAscendingOrder.slice(-request.limit);
      });

      return fitNewestContiguousMessages({
        messages,
        buildResponse: (fittedMessages) => {
          const oldest = fittedMessages[0];

          return {
            streamId,
            beforeSequence: request.beforeSequence,
            messages: fittedMessages,
            nextBeforeSequence: oldest?.sequence ?? null,
            hasMoreBefore: oldest === undefined ? false : oldest.sequence > 1,
          };
        },
        measureFinalEnvelope: context.measureFinalEnvelope,
      });
    },

    async syncAfter(request, context) {
      await authorizeChannelRead(config.authorizeRead, context.actorId, request.channelId);
      const streamId = getChannelStreamId(request.channelId);

      const snapshot = await executeReadSnapshot(db, async (transaction) => {
        const stream = await readStreamMetadata(transaction, streamId, request.channelId);
        const headSequence = stream?.headSequence ?? 0;
        const throughSequence = request.throughSequence ?? headSequence;

        if (
          request.afterSequence > headSequence ||
          throughSequence > headSequence ||
          request.afterSequence > throughSequence
        ) {
          throw new StreamMessagesDomainError("invalid_cursor");
        }

        if (stream === undefined || request.afterSequence === throughSequence) {
          return {
            messages: [] as PublicMessage[],
            throughSequence,
          };
        }

        const queryLimit = request.limit + 1;
        const rows = await selectAfterRows(
          transaction,
          streamId,
          request.afterSequence,
          throughSequence,
          queryLimit,
        );
        const messages = rows.map(parseMessageRow);
        const expectedCount = Math.min(throughSequence - request.afterSequence, queryLimit);

        if (messages.length !== expectedCount) {
          throwSequenceGap(streamId, request.afterSequence + 1, messages[0]?.sequence);
        }

        assertExpectedSequenceWindow(messages, {
          expectedFirst: request.afterSequence + 1,
          expectedLast: request.afterSequence + expectedCount,
          streamId,
        });

        return {
          messages: messages.slice(0, request.limit),
          throughSequence,
        };
      });

      return fitOldestContiguousMessages({
        messages: snapshot.messages,
        buildResponse: (messages) => {
          const newest = messages.at(-1);
          const nextAfterSequence = newest?.sequence ?? snapshot.throughSequence;

          return {
            streamId,
            afterSequence: request.afterSequence,
            throughSequence: snapshot.throughSequence,
            messages,
            nextAfterSequence,
            hasMoreAfter: nextAfterSequence < snapshot.throughSequence,
          };
        },
        measureFinalEnvelope: context.measureFinalEnvelope,
      });
    },
  };
}

async function authorizeChannelRead(
  authorizeRead: ChannelReadAuthorizer,
  actorId: string,
  channelId: string,
): Promise<void> {
  if (actorId.trim().length === 0) {
    throw new TypeError("Stream Messages actorId는 비어 있을 수 없습니다.");
  }

  const authorization = await authorizeRead({ actorId, channelId });

  if (authorization.status === "denied") {
    throw new StreamMessagesDomainError("stream_unavailable");
  }
}

function getChannelStreamId(channelId: string): string {
  return getCanonicalStreamId({
    type: "channel",
    channelId,
  });
}

async function executeReadSnapshot<Result>(
  db: Kysely<MessageSendDatabase>,
  execute: (transaction: Transaction<MessageSendDatabase>) => Promise<Result>,
): Promise<Result> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(execute);
}

async function readStreamMetadata(
  db: Transaction<MessageSendDatabase>,
  streamId: string,
  channelId: string,
): Promise<StreamMetadata | undefined> {
  const row = await db
    .selectFrom("message_streams")
    .select(["target_type as targetType", "target_id as targetId", "last_sequence as headSequence"])
    .where("stream_id", "=", streamId)
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  if (row.targetType !== "channel" || row.targetId !== channelId) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", {
      streamId,
      expectedTargetType: "channel",
      expectedTargetId: channelId,
      actualTargetType: String(row.targetType),
      actualTargetId: String(row.targetId),
    });
  }

  if (!Number.isSafeInteger(row.headSequence) || row.headSequence < 0) {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", {
      streamId,
      field: "last_sequence",
    });
  }

  return {
    headSequence: row.headSequence,
  };
}

async function selectLatestRows(
  db: Transaction<MessageSendDatabase>,
  streamId: string,
  headSequence: number,
): Promise<MessageRow[]> {
  const rows = await selectMessageRows(db)
    .where("stream_id", "=", streamId)
    .where("sequence", "<=", headSequence)
    .orderBy("sequence", "desc")
    .limit(LATEST_QUERY_ROW_LIMIT)
    .execute();

  return rows as MessageRow[];
}

async function selectOlderRows(
  db: Transaction<MessageSendDatabase>,
  streamId: string,
  beforeSequence: number,
  limit: number,
): Promise<MessageRow[]> {
  const rows = await selectMessageRows(db)
    .where("stream_id", "=", streamId)
    .where("sequence", "<", beforeSequence)
    .orderBy("sequence", "desc")
    .limit(limit)
    .execute();

  return rows as MessageRow[];
}

async function selectAfterRows(
  db: Transaction<MessageSendDatabase>,
  streamId: string,
  afterSequence: number,
  throughSequence: number,
  limit: number,
): Promise<MessageRow[]> {
  const rows = await selectMessageRows(db)
    .where("stream_id", "=", streamId)
    .where("sequence", ">", afterSequence)
    .where("sequence", "<=", throughSequence)
    .orderBy("sequence", "asc")
    .limit(limit)
    .execute();

  return rows as MessageRow[];
}

function selectMessageRows(db: Transaction<MessageSendDatabase>) {
  return db
    .selectFrom("messages")
    .select([
      "message_id as messageId",
      "stream_id as streamId",
      "sequence",
      "sender_actor_id as senderActorId",
      "target_type as targetType",
      "target_id as targetId",
      "content_type as contentType",
      "content_text as contentText",
      "sent_at_client as sentAtClient",
      "created_at as createdAt",
    ]);
}

function parseMessageRow(row: MessageRow): PublicMessage {
  const metadata = {
    messageId: String(row.messageId),
    streamId: String(row.streamId),
    sequence: String(row.sequence),
  };
  const parsed = PublicMessageSchema.safeParse({
    messageId: row.messageId,
    streamId: row.streamId,
    sequence: row.sequence,
    senderActorId: row.senderActorId,
    target:
      row.targetType === "channel"
        ? {
            type: "channel",
            channelId: row.targetId,
          }
        : {
            type: row.targetType,
          },
    content:
      row.contentType === "text"
        ? {
            type: "text",
            text: row.contentText,
          }
        : {
            type: row.contentType,
          },
    createdAt: toIsoDateTime(row.createdAt),
    ...(row.sentAtClient === null || row.sentAtClient === undefined
      ? {}
      : { sentAtClient: toIsoDateTime(row.sentAtClient) }),
  });

  if (!parsed.success) {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", metadata);
  }

  if (parsed.data.streamId !== getCanonicalStreamId(parsed.data.target)) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", metadata);
  }

  return parsed.data;
}

function toIsoDateTime(value: unknown): string | unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function assertExpectedSequenceWindow(
  messages: readonly PublicMessage[],
  expected: {
    expectedFirst: number;
    expectedLast: number;
    streamId: string;
  },
): void {
  if (expected.expectedFirst > expected.expectedLast) {
    if (messages.length > 0) {
      throwSequenceGap(expected.streamId, expected.expectedFirst, messages[0]?.sequence);
    }
    return;
  }

  if (
    messages.length !== expected.expectedLast - expected.expectedFirst + 1 ||
    messages[0]?.sequence !== expected.expectedFirst ||
    messages.at(-1)?.sequence !== expected.expectedLast
  ) {
    throwSequenceGap(expected.streamId, expected.expectedFirst, messages[0]?.sequence);
  }

  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index]!.sequence !== messages[index - 1]!.sequence + 1) {
      throwSequenceGap(
        expected.streamId,
        messages[index - 1]!.sequence + 1,
        messages[index]!.sequence,
      );
    }
  }
}

function throwSequenceGap(
  streamId: string,
  expectedSequence: number,
  actualSequence: number | undefined,
): never {
  throw new StreamMessagesDataIntegrityError("sequence_gap", {
    streamId,
    expectedSequence,
    actualSequence: actualSequence ?? "missing",
  });
}
