import {
  getUtf8ByteLength,
  MAX_TEXT_UTF8_BYTES,
  MessageTargetSchema,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  ActorId,
  ChatMessage,
  MessageId,
  MessageTarget,
  Sequence,
  StreamId,
} from "@wake-surfer/realtime-chat-message-contracts";

export type SendMessageIdempotencyKey = Readonly<{
  senderActorId: ActorId;
  idempotencyKey: string;
}>;

export type SendMessageInput = SendMessageIdempotencyKey &
  Readonly<{
    target: MessageTarget;
    text: string;
  }>;

export type AppendedTextMessage = Readonly<{
  messageId: MessageId;
  streamId: StreamId;
  sequence: Sequence;
  senderActorId: ActorId;
  target: MessageTarget;
  text: string;
  createdAt: Date;
}>;

export type SendMessageResult =
  | {
      status: "accepted";
      message: AppendedTextMessage;
    }
  | {
      status: "rejected";
      reason: "invalid_text" | "target_not_found" | "write_forbidden" | "idempotency_conflict";
    };

export type MessageIdGenerator = {
  generate: () => MessageId;
};

export type OutboundEventIdGenerator = {
  generate: () => string;
};

export function assertActorId(actorId: ActorId): void {
  assertNonBlankString(actorId, "actorId");
}

export function assertIdempotencyKey(idempotencyKey: string): void {
  assertNonBlankString(idempotencyKey, "idempotencyKey");

  if (idempotencyKey.trim() !== idempotencyKey) {
    throw new Error("idempotencyKey 앞뒤에는 공백을 사용할 수 없습니다.");
  }
}

export function assertMessageId(messageId: MessageId): void {
  assertNonBlankString(messageId, "messageId");
}

export function assertStreamId(streamId: StreamId): void {
  assertNonBlankString(streamId, "streamId");
}

export function assertMessageTarget(target: unknown): asserts target is MessageTarget {
  if (!MessageTargetSchema.safeParse(target).success) {
    throw new Error("message target이 올바르지 않습니다.");
  }
}

export function normalizeMessageText(text: string): string | undefined {
  const normalized = text.trim();

  if (normalized.length === 0 || getUtf8ByteLength(normalized) > MAX_TEXT_UTF8_BYTES) {
    return undefined;
  }

  return normalized;
}

export function toChatMessage(message: AppendedTextMessage): ChatMessage {
  return {
    messageId: message.messageId,
    streamId: message.streamId,
    sequence: message.sequence,
    senderActorId: message.senderActorId,
    target: message.target,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
  };
}

export const createDefaultMessageIdGenerator = (): MessageIdGenerator => ({
  generate() {
    return `msg_${globalThis.crypto.randomUUID()}`;
  },
});

export const createDefaultOutboundEventIdGenerator = (): OutboundEventIdGenerator => ({
  generate() {
    return `evt_${globalThis.crypto.randomUUID()}`;
  },
});

function assertNonBlankString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName}는 비어 있지 않은 문자열이어야 합니다.`);
  }
}
