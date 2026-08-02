import { StreamMessagesDataIntegrityError } from "./errors";

export type ChannelReadAuthorization = { status: "allowed" } | { status: "denied" };

export type ChannelReadAuthorizer = (input: {
  actorId: string;
  channelId: string;
}) => ChannelReadAuthorization | Promise<ChannelReadAuthorization>;

export type StreamMessagesQueryContext = {
  actorId: string;
};

export type StreamMessage = {
  messageId: string;
  sequence: number;
  senderActorId: string;
  text: string;
  createdAt: Date;
};

export type StreamMessagesFailureCode = "stream_unavailable" | "invalid_cursor";

export type StreamMessagesFailure<Code extends StreamMessagesFailureCode> = {
  status: "failure";
  code: Code;
};

export const MAX_LATEST_MESSAGES_QUERY_COUNT = 5;
export const MAX_STREAM_MESSAGES_QUERY_PAGE_SIZE = 100;

export type RawStreamMessageRow = {
  messageId: unknown;
  streamId: unknown;
  sequence: unknown;
  senderActorId: unknown;
  targetType: unknown;
  targetId: unknown;
  contentText: unknown;
  createdAt: unknown;
};

export type RawStreamMetadataRow = {
  targetType: unknown;
  targetId: unknown;
  headSequence: unknown;
};

export type ChannelStreamMetadata =
  | {
      status: "missing";
      headSequence: 0;
    }
  | {
      status: "found";
      headSequence: number;
    };

export async function authorizeChannelRead(
  authorizeRead: ChannelReadAuthorizer,
  actorId: string,
  channelId: string,
): Promise<ChannelReadAuthorization> {
  if (actorId.trim().length === 0) {
    throw new TypeError("Stream Messages actorId는 비어 있을 수 없습니다.");
  }

  return authorizeRead({ actorId, channelId });
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
  return `channel:${channelId}`;
}

export function parseChannelStreamMetadata(
  row: RawStreamMetadataRow | undefined,
  expected: {
    streamId: string;
    channelId: string;
  },
): ChannelStreamMetadata {
  if (row === undefined) {
    return {
      status: "missing",
      headSequence: 0,
    };
  }

  if (row.targetType !== "channel" || row.targetId !== expected.channelId) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", {
      streamId: expected.streamId,
      expectedTargetType: "channel",
      expectedTargetId: expected.channelId,
      actualTargetType: String(row.targetType),
      actualTargetId: String(row.targetId),
    });
  }

  if (!Number.isSafeInteger(row.headSequence) || (row.headSequence as number) < 0) {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", {
      streamId: expected.streamId,
      field: "last_sequence",
    });
  }

  return {
    status: "found",
    headSequence: row.headSequence as number,
  };
}

export function parseStreamMessageRow(
  row: RawStreamMessageRow,
  expected: {
    streamId: string;
    channelId: string;
  },
): StreamMessage {
  const metadata = {
    messageId: String(row.messageId),
    streamId: String(row.streamId),
    sequence: String(row.sequence),
  };

  if (
    row.streamId !== expected.streamId ||
    row.targetType !== "channel" ||
    row.targetId !== expected.channelId
  ) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", metadata);
  }

  const messageId = parseNonBlankString(row.messageId);
  const sequence = parsePositiveSafeInteger(row.sequence);
  const senderActorId = parseNonBlankString(row.senderActorId);
  const contentText = parseNonBlankString(row.contentText);
  const createdAt = parseDate(row.createdAt);

  if (
    messageId === undefined ||
    sequence === undefined ||
    senderActorId === undefined ||
    contentText === undefined ||
    createdAt === undefined
  ) {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", metadata);
  }

  const message: StreamMessage = {
    messageId,
    sequence,
    senderActorId,
    text: contentText,
    createdAt,
  };

  return message;
}

export function assertExpectedSequenceWindow(
  messages: readonly { sequence: number }[],
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

function parseNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    return undefined;
  }

  return value;
}

function parsePositiveSafeInteger(value: unknown): number | undefined {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return undefined;
  }

  return value as number;
}

function parseDate(value: unknown): Date | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return undefined;
  }

  return value;
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
