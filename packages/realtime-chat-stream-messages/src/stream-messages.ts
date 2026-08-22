import { StreamMessagesDataIntegrityError } from "./errors";
import { parsePersistedTextMessageContent } from "./persisted-message-content";

export type StreamMessagesTarget =
  | {
      type: "channel";
      channelId: string;
    }
  | {
      type: "dm";
      dmConversationId: string;
    }
  | {
      type: "thread";
      threadId: string;
    };

export type MessageStreamReadAuthorization = { status: "allowed" } | { status: "denied" };

export type MessageStreamReadAuthorizer = (input: {
  actorId: string;
  target: Exclude<StreamMessagesTarget, { type: "thread" }>;
}) => MessageStreamReadAuthorization | Promise<MessageStreamReadAuthorization>;

export type StreamMessagesQueryContext = {
  actorId: string;
};

type StreamMessageBase = {
  messageId: string;
  sequence: number;
  senderActorId: string;
  target: StreamMessagesTarget;
  createdAt: Date;
  sentAtClient?: Date;
};

export type StreamMessage =
  | (StreamMessageBase & {
      content: {
        type: "text";
        text: string;
      };
    })
  | (StreamMessageBase & {
      content: null;
      deletedAt: Date;
    });

export type StreamMessagesFailureCode = "stream_unavailable" | "invalid_cursor";

export type StreamMessagesFailure<Code extends StreamMessagesFailureCode> = {
  status: "failure";
  code: Code;
};

export function createStreamMessagesFailure<Code extends StreamMessagesFailureCode>(
  code: Code,
): StreamMessagesFailure<Code> {
  return {
    status: "failure",
    code,
  };
}

export const MAX_LATEST_MESSAGES_QUERY_COUNT = 5;
export const MAX_STREAM_MESSAGES_QUERY_PAGE_SIZE = 100;

export type RawStreamMessageRow = {
  messageId: unknown;
  streamId: unknown;
  sequence: unknown;
  senderActorId: unknown;
  targetType: unknown;
  targetId: unknown;
  content: unknown;
  createdAt: unknown;
  deletedAt?: unknown;
};

export type RawStreamMetadataRow = {
  targetType: unknown;
  targetId: unknown;
  headSequence: unknown;
};

export type MessageStreamMetadata =
  | {
      status: "missing";
      headSequence: 0;
    }
  | {
      status: "found";
      headSequence: number;
    };

export async function authorizeMessageStreamRead(
  authorizeRead: MessageStreamReadAuthorizer,
  actorId: string,
  target: Exclude<StreamMessagesTarget, { type: "thread" }>,
): Promise<MessageStreamReadAuthorization> {
  assertActorId(actorId);

  return authorizeRead({ actorId, target });
}

export function assertActorId(actorId: string): void {
  assertNonBlankIdentifier(actorId, "actorId");
}

export function assertStreamMessagesTarget(target: StreamMessagesTarget): void {
  if (target === null || typeof target !== "object") {
    throw new TypeError("target은 message target 객체여야 합니다.");
  }

  switch (target.type) {
    case "channel":
      assertNonBlankIdentifier(target.channelId, "target.channelId");
      return;
    case "dm":
      assertNonBlankIdentifier(target.dmConversationId, "target.dmConversationId");
      return;
    case "thread":
      assertNonBlankIdentifier(target.threadId, "target.threadId");
      return;
    default:
      throw new TypeError("지원하지 않는 message target입니다.");
  }
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

export function parseMessageStreamMetadata(
  row: RawStreamMetadataRow | undefined,
  expected: {
    streamId: string;
    target: StreamMessagesTarget;
  },
): MessageStreamMetadata {
  if (row === undefined) {
    return {
      status: "missing",
      headSequence: 0,
    };
  }

  const expectedTargetType = getStreamMessagesTargetType(expected.target);
  const expectedTargetId = getStreamMessagesTargetId(expected.target);

  if (row.targetType !== expectedTargetType || row.targetId !== expectedTargetId) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", {
      streamId: expected.streamId,
      expectedTargetType,
      expectedTargetId,
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
    target: StreamMessagesTarget;
  },
): StreamMessage {
  const metadata = {
    messageId: String(row.messageId),
    streamId: String(row.streamId),
    sequence: String(row.sequence),
  };

  const expectedTargetType = getStreamMessagesTargetType(expected.target);
  const expectedTargetId = getStreamMessagesTargetId(expected.target);

  if (
    row.streamId !== expected.streamId ||
    row.targetType !== expectedTargetType ||
    row.targetId !== expectedTargetId
  ) {
    throw new StreamMessagesDataIntegrityError("stream_target_mismatch", metadata);
  }

  const messageId = parseNonBlankString(row.messageId);
  const sequence = parsePositiveSafeInteger(row.sequence);
  const senderActorId = parseNonBlankString(row.senderActorId);
  const createdAt = parseDate(row.createdAt);

  if (
    messageId === undefined ||
    sequence === undefined ||
    senderActorId === undefined ||
    createdAt === undefined
  ) {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", metadata);
  }

  const base = {
    messageId,
    sequence,
    senderActorId,
    target: expected.target,
    createdAt,
  };

  if (row.content === null) {
    const deletedAt = parseDate(row.deletedAt);

    if (deletedAt === undefined) {
      throw new StreamMessagesDataIntegrityError("invalid_storage_row", metadata);
    }

    return {
      ...base,
      content: null,
      deletedAt,
    };
  }

  if (row.deletedAt !== null && row.deletedAt !== undefined) {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", metadata);
  }

  let content;

  try {
    content = parsePersistedTextMessageContent(row.content);
  } catch {
    throw new StreamMessagesDataIntegrityError("invalid_storage_row", metadata);
  }

  const message: StreamMessage = {
    ...base,
    content: {
      type: "text",
      text: content.text,
    },
  };

  return message;
}

export function getStreamMessagesTargetType(
  target: StreamMessagesTarget,
): StreamMessagesTarget["type"] {
  return target.type;
}

export function getStreamMessagesTargetId(target: StreamMessagesTarget): string {
  switch (target.type) {
    case "channel":
      return target.channelId;
    case "dm":
      return target.dmConversationId;
    case "thread":
      return target.threadId;
  }
}

export function getCanonicalStreamMessagesId(target: StreamMessagesTarget): string {
  return `${getStreamMessagesTargetType(target)}:${getStreamMessagesTargetId(target)}`;
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
