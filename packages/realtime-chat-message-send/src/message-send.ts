import { MessageTargetSchema } from "@wake-surfer/realtime-chat-message-send-contracts";
import type {
  AcceptedTextMessage,
  MessageTarget,
} from "@wake-surfer/realtime-chat-message-send-contracts";

const MAX_TEXT_UTF8_BYTES = 8_192;

export type SenderScopedIdempotencyKey = Readonly<{
  senderActorId: string;
  idempotencyKey: string;
}>;

export type SendMessageInput = SenderScopedIdempotencyKey &
  Readonly<{
    target: MessageTarget;
    text: string;
  }>;

export type AppendedTextMessage = Readonly<{
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
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
  generate: () => string;
};

export type OutboundEventIdGenerator = {
  generate: () => string;
};

export function assertActorId(actorId: string): void {
  assertNonBlankString(actorId, "actorId");
}

export function assertIdempotencyKey(idempotencyKey: string): void {
  assertNonBlankString(idempotencyKey, "idempotencyKey");

  if (idempotencyKey.trim() !== idempotencyKey) {
    throw new Error("idempotencyKey 앞뒤에는 공백을 사용할 수 없습니다.");
  }
}

export function assertMessageId(messageId: string): void {
  assertNonBlankString(messageId, "messageId");
}

export function assertStreamId(streamId: string): void {
  assertNonBlankString(streamId, "streamId");
}

export function assertSendMessageTarget(target: unknown): asserts target is MessageTarget {
  if (!MessageTargetSchema.safeParse(target).success) {
    throw new Error("send message target이 올바르지 않습니다.");
  }
}

export function normalizeMessageText(text: string): string | undefined {
  const normalized = text.trim();

  if (normalized.length === 0 || getUtf8ByteLength(normalized) > MAX_TEXT_UTF8_BYTES) {
    return undefined;
  }

  return normalized;
}

export function getSendMessageTargetType(
  target: MessageTarget,
): MessageTarget["type"] {
  return target.type;
}

export function getSendMessageTargetId(target: MessageTarget): string {
  switch (target.type) {
    case "channel":
      return target.channelId;
    case "dm":
      return target.dmConversationId;
    case "thread":
      return target.threadId;
  }
}

export function getSendMessageStreamId(target: MessageTarget): string {
  return `${getSendMessageTargetType(target)}:${getSendMessageTargetId(target)}`;
}

export function toAcceptedTextMessage(message: AppendedTextMessage): AcceptedTextMessage {
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

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertNonBlankString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName}는 비어 있지 않은 문자열이어야 합니다.`);
  }
}
