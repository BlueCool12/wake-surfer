import type {
  ChatMessageCreatedEvent,
  MessageAcceptedResponse,
  PublicMessageDto,
  RealtimeChatErrorCode,
} from "@wake-surfer/realtime-chat-contracts";
import type { StoredRealtimeChatMessage } from "../runtime-deps";

export function validateMessageText(
  text: string,
  maxLength: number,
): RealtimeChatErrorCode | undefined {
  if (text.trim() === "" || text.length > maxLength) {
    return "MESSAGE_CONTENT_INVALID";
  }

  return undefined;
}

export function toPublicMessageDto(message: StoredRealtimeChatMessage): PublicMessageDto {
  return {
    messageId: message.messageId,
    streamId: message.streamId,
    streamType: message.streamType,
    sequence: message.sequence,
    ...(message.senderId ? { senderId: message.senderId } : {}),
    messageType: message.messageType,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export function toChatMessageCreatedEvent(
  message: StoredRealtimeChatMessage,
): ChatMessageCreatedEvent {
  return {
    type: "chat.message.created",
    messageId: message.messageId,
    streamId: message.streamId,
    streamType: message.streamType,
    sequence: message.sequence,
    ...(message.senderId ? { senderId: message.senderId } : {}),
    messageType: message.messageType,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export function toAcceptedResponse(
  commandId: string,
  message: StoredRealtimeChatMessage,
  clientMessageId?: string,
): MessageAcceptedResponse {
  return {
    status: "accepted",
    commandId,
    ...(clientMessageId ? { clientMessageId } : {}),
    messageId: message.messageId,
    streamId: message.streamId,
    streamType: message.streamType,
    sequence: message.sequence,
    serverCreatedAt: message.createdAt,
  };
}
