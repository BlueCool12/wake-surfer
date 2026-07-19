import {
  getCanonicalStreamId,
  PublicMessageSchema,
  type PublicMessage,
} from "@wake-surfer/realtime-chat-message-contracts";

import { StreamMessagesDataIntegrityError, StreamMessagesDomainError } from "./errors.js";

export type ChannelReadAuthorization = { status: "allowed" } | { status: "denied" };

export type ChannelReadAuthorizer = (input: {
  actorId: string;
  channelId: string;
}) => ChannelReadAuthorization | Promise<ChannelReadAuthorization>;

export type StreamMessagesQueryContext = {
  actorId: string;
};

export const MAX_LATEST_MESSAGES_QUERY_COUNT = 5;
export const MAX_STREAM_MESSAGES_QUERY_PAGE_SIZE = 100;

export type StreamMessageRow = {
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

export async function authorizeChannelRead(
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

export function assertChannelId(channelId: string): void {
  assertNonBlankIdentifier(channelId, "channelId");
}

export function assertBeforeSequence(beforeSequence: number): void {
  assertSafeIntegerInRange(beforeSequence, "beforeSequence", 1);
}

export function assertAfterSequence(afterSequence: number): void {
  assertSafeIntegerInRange(afterSequence, "afterSequence", 0);
}

export function assertThroughSequence(throughSequence: number | undefined): void {
  if (throughSequence !== undefined) {
    assertSafeIntegerInRange(throughSequence, "throughSequence", 0);
  }
}

export function assertQueryPageSize(limit: number): void {
  assertSafeIntegerInRange(limit, "limit", 1, MAX_STREAM_MESSAGES_QUERY_PAGE_SIZE);
}

export function getChannelStreamId(channelId: string): string {
  return getCanonicalStreamId({
    type: "channel",
    channelId,
  });
}

export function parseStreamMessageRow(row: StreamMessageRow): PublicMessage {
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

export function assertExpectedSequenceWindow(
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

export function throwSequenceGap(
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

function toIsoDateTime(value: unknown): string | unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function assertNonBlankIdentifier(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`${fieldName}는 앞뒤 공백이 없는 문자열이어야 합니다.`);
  }
}

function assertSafeIntegerInRange(
  value: number,
  fieldName: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${fieldName}는 ${minimum} 이상 ${maximum} 이하의 safe integer여야 합니다.`,
    );
  }
}
