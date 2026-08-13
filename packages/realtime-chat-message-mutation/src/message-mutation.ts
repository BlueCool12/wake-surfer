import type { MessageTarget } from "@wake-surfer/realtime-chat-message-contracts";
import { MAX_TEXT_MESSAGE_UTF8_BYTES } from "@wake-surfer/realtime-chat-message-send/persisted-message-content";

export type MessageMutationContext = Readonly<{
  actorId: string;
}>;

export type MessageMutationCapability = "message:edit_own" | "message:delete_own";

export type MessageMutationAuthorizer = (input: {
  actorId: string;
  target: MessageTarget;
  capability: MessageMutationCapability;
}) => boolean | Promise<boolean>;

export type EditedTextMessage = Readonly<{
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
  target: MessageTarget;
  version: number;
  text: string;
  createdAt: Date;
  editedAt: Date;
}>;

export type DeletedMessage = Readonly<{
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
  target: MessageTarget;
  version: number;
  createdAt: Date;
  deletedAt: Date;
}>;

export type EditMessageResult =
  | {
      status: "accepted";
      message: EditedTextMessage;
    }
  | {
      status: "rejected";
      reason: "invalid_content" | "write_forbidden";
    }
  | {
      status: "rejected";
      reason: "message_deleted";
      message: DeletedMessage;
    };

export type DeleteMessageResult =
  | {
      status: "accepted";
      message: DeletedMessage;
    }
  | {
      status: "rejected";
      reason: "write_forbidden";
    };

export function assertActorId(actorId: string): void {
  assertNonBlankString(actorId, "actorId");
}

export function assertMessageId(messageId: string): void {
  assertNonBlankString(messageId, "messageId");
}

export function normalizeEditedMessageText(text: string): string | undefined {
  const normalized = text.trim();

  if (
    normalized.length === 0 ||
    new TextEncoder().encode(normalized).byteLength > MAX_TEXT_MESSAGE_UTF8_BYTES
  ) {
    return undefined;
  }

  return normalized;
}

export function parseMessageTarget(
  targetType: MessageTarget["type"],
  targetId: string,
): MessageTarget {
  assertNonBlankString(targetId, "message targetId");

  switch (targetType) {
    case "channel":
      return {
        type: "channel",
        channelId: targetId,
      };
    case "dm":
      return {
        type: "dm",
        dmConversationId: targetId,
      };
    case "thread":
      return {
        type: "thread",
        threadId: targetId,
      };
  }
}

export function isDeletedMessage(
  message: EditedTextMessage | DeletedMessage,
): message is DeletedMessage {
  return "deletedAt" in message;
}

function assertNonBlankString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName}는 비어 있지 않은 문자열이어야 합니다.`);
  }
}
