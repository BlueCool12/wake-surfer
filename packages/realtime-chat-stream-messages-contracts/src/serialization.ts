import { getUtf8ByteLength } from "@wake-surfer/realtime-chat-message-contracts";
import type { MessageTarget, PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";

import { MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES } from "./common.js";
import {
  LatestStreamMessagesHttpResponseSchema,
  type LatestStreamMessagesHttpResponse,
} from "./latest.js";
import {
  OlderStreamMessagesHttpResponseSchema,
  type OlderStreamMessagesHttpResponse,
} from "./older.js";
import { ChatStreamSyncedEventSchema, type ChatStreamSyncedEvent } from "./sync-after.js";

export type FinalEnvelopeMeasurement = {
  utf8ByteLength: number;
  isWithinLimit: boolean;
};

export type FinalEnvelopeMeasurer<Candidate> = (candidate: Candidate) => FinalEnvelopeMeasurement;

export function serializeLatestStreamMessagesHttpResponse(
  value: LatestStreamMessagesHttpResponse,
): string {
  const response = LatestStreamMessagesHttpResponseSchema.parse(value);

  return JSON.stringify({
    streamId: response.streamId,
    throughSequence: response.throughSequence,
    messages: response.messages.map(toCanonicalPublicMessage),
    nextBeforeSequence: response.nextBeforeSequence,
    hasMoreBefore: response.hasMoreBefore,
  });
}

export function getLatestStreamMessagesHttpResponseUtf8ByteLength(
  value: LatestStreamMessagesHttpResponse,
): number {
  return getUtf8ByteLength(serializeLatestStreamMessagesHttpResponse(value));
}

export function measureLatestStreamMessagesHttpFinalEnvelope(
  value: LatestStreamMessagesHttpResponse,
): FinalEnvelopeMeasurement {
  return measureSerializedEnvelope(getLatestStreamMessagesHttpResponseUtf8ByteLength(value));
}

export function serializeOlderStreamMessagesHttpResponse(
  value: OlderStreamMessagesHttpResponse,
): string {
  const response = OlderStreamMessagesHttpResponseSchema.parse(value);

  return JSON.stringify({
    streamId: response.streamId,
    beforeSequence: response.beforeSequence,
    messages: response.messages.map(toCanonicalPublicMessage),
    nextBeforeSequence: response.nextBeforeSequence,
    hasMoreBefore: response.hasMoreBefore,
  });
}

export function getOlderStreamMessagesHttpResponseUtf8ByteLength(
  value: OlderStreamMessagesHttpResponse,
): number {
  return getUtf8ByteLength(serializeOlderStreamMessagesHttpResponse(value));
}

export function measureOlderStreamMessagesHttpFinalEnvelope(
  value: OlderStreamMessagesHttpResponse,
): FinalEnvelopeMeasurement {
  return measureSerializedEnvelope(getOlderStreamMessagesHttpResponseUtf8ByteLength(value));
}

export function serializeChatStreamSyncedEvent(value: ChatStreamSyncedEvent): string {
  const event = ChatStreamSyncedEventSchema.parse(value);

  return JSON.stringify({
    requestId: event.requestId,
    streamId: event.streamId,
    afterSequence: event.afterSequence,
    throughSequence: event.throughSequence,
    messages: event.messages.map(toCanonicalPublicMessage),
    nextAfterSequence: event.nextAfterSequence,
    hasMoreAfter: event.hasMoreAfter,
  });
}

export function getChatStreamSyncedEventUtf8ByteLength(value: ChatStreamSyncedEvent): number {
  return getUtf8ByteLength(serializeChatStreamSyncedEvent(value));
}

export function measureChatStreamSyncedFinalEnvelope(
  value: ChatStreamSyncedEvent,
): FinalEnvelopeMeasurement {
  return measureSerializedEnvelope(getChatStreamSyncedEventUtf8ByteLength(value));
}

function measureSerializedEnvelope(utf8ByteLength: number): FinalEnvelopeMeasurement {
  return {
    utf8ByteLength,
    isWithinLimit: utf8ByteLength <= MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  };
}

function toCanonicalPublicMessage(message: PublicMessage): PublicMessage {
  const identity = {
    messageId: message.messageId,
    streamId: message.streamId,
    sequence: message.sequence,
    senderActorId: message.senderActorId,
    target: toCanonicalMessageTarget(message.target),
  };
  const canonical: PublicMessage =
    message.content === null
      ? {
          ...identity,
          content: null,
          createdAt: message.createdAt,
          deletedAt: message.deletedAt,
        }
      : {
          ...identity,
          content: {
            type: "text",
            text: message.content.text,
          },
          createdAt: message.createdAt,
          ...(message.editedAt === undefined ? {} : { editedAt: message.editedAt }),
        };

  return message.sentAtClient === undefined
    ? canonical
    : {
        ...canonical,
        sentAtClient: message.sentAtClient,
      };
}

function toCanonicalMessageTarget(target: MessageTarget): MessageTarget {
  switch (target.type) {
    case "channel":
      return {
        type: "channel",
        channelId: target.channelId,
      };
    case "dm":
      return {
        type: "dm",
        dmConversationId: target.dmConversationId,
      };
    case "thread":
      return {
        type: "thread",
        threadId: target.threadId,
      };
  }
}
