import {
  getCanonicalStreamId,
  getUtf8ByteLength,
  PublicMessageSchema,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  ChannelId,
  MessageTarget,
  PublicMessage,
  StreamId,
} from "@wake-surfer/realtime-chat-message-contracts";
import { z } from "zod";

export type RequestId = string;

export const DEFAULT_STREAM_MESSAGES_PAGE_LIMIT = 50;
export const MAX_STREAM_MESSAGES_PAGE_LIMIT = 100;
export const MAX_LATEST_STREAM_MESSAGES = 5;
export const MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES = 49_152;
export const MAX_REQUEST_ID_LENGTH = 128;

const NonBlankStringSchema = z.string().trim().min(1);
const SafeIntegerSchema = z.number().int().safe();
const PositiveSafeIntegerSchema = SafeIntegerSchema.positive();
const NonNegativeSafeIntegerSchema = SafeIntegerSchema.nonnegative();

export const RequestIdSchema = z
  .string()
  .min(1)
  .max(MAX_REQUEST_ID_LENGTH)
  .refine((requestId) => requestId.trim().length > 0, "requestId는 공백일 수 없습니다.");
export const ChannelIdSchema = NonBlankStringSchema;
export const ChannelStreamIdSchema = z.string().refine((streamId) => {
  const prefix = "channel:";

  if (!streamId.startsWith(prefix)) {
    return false;
  }

  const channelId = streamId.slice(prefix.length);
  const parsedChannelId = ChannelIdSchema.safeParse(channelId);

  return parsedChannelId.success && parsedChannelId.data === channelId;
}, "streamId는 canonical channel stream ID여야 합니다.");
export const PageLimitSchema = PositiveSafeIntegerSchema.max(MAX_STREAM_MESSAGES_PAGE_LIMIT);
export const BeforeSequenceSchema = PositiveSafeIntegerSchema;
export const AfterSequenceSchema = NonNegativeSafeIntegerSchema;
export const ThroughSequenceSchema = NonNegativeSafeIntegerSchema;

export const LatestStreamMessagesHttpRequestSchema = z.strictObject({
  channelId: ChannelIdSchema,
});

export type LatestStreamMessagesHttpRequest = z.infer<typeof LatestStreamMessagesHttpRequestSchema>;

export const OlderStreamMessagesHttpRequestSchema = z.strictObject({
  channelId: ChannelIdSchema,
  beforeSequence: BeforeSequenceSchema,
  limit: PageLimitSchema.default(DEFAULT_STREAM_MESSAGES_PAGE_LIMIT),
});

export type OlderStreamMessagesHttpRequest = z.infer<typeof OlderStreamMessagesHttpRequestSchema>;

export const SyncAfterStreamMessagesRequestSchema = z
  .strictObject({
    channelId: ChannelIdSchema,
    afterSequence: AfterSequenceSchema,
    throughSequence: ThroughSequenceSchema.optional(),
    limit: PageLimitSchema.default(DEFAULT_STREAM_MESSAGES_PAGE_LIMIT),
  })
  .superRefine((request, context) => {
    if (request.throughSequence !== undefined && request.afterSequence > request.throughSequence) {
      context.addIssue({
        code: "custom",
        message: "afterSequence는 throughSequence보다 클 수 없습니다.",
        path: ["afterSequence"],
      });
    }
  });

export type SyncAfterStreamMessagesRequest = z.infer<typeof SyncAfterStreamMessagesRequestSchema>;

export const InternalSyncAfterStreamMessagesHttpRequestSchema =
  SyncAfterStreamMessagesRequestSchema;

export type InternalSyncAfterStreamMessagesHttpRequest = SyncAfterStreamMessagesRequest;

export const ChatStreamSyncEventSchema = z
  .strictObject({
    requestId: RequestIdSchema,
    channelId: ChannelIdSchema,
    afterSequence: AfterSequenceSchema,
    throughSequence: ThroughSequenceSchema.optional(),
    limit: PageLimitSchema.default(DEFAULT_STREAM_MESSAGES_PAGE_LIMIT),
  })
  .superRefine((event, context) => {
    if (event.throughSequence !== undefined && event.afterSequence > event.throughSequence) {
      context.addIssue({
        code: "custom",
        message: "afterSequence는 throughSequence보다 클 수 없습니다.",
        path: ["afterSequence"],
      });
    }
  });

export type ChatStreamSyncEvent = z.infer<typeof ChatStreamSyncEventSchema>;

export const LatestStreamMessagesResponseSchema = z
  .strictObject({
    streamId: ChannelStreamIdSchema,
    throughSequence: ThroughSequenceSchema,
    messages: z.array(PublicMessageSchema).max(MAX_LATEST_STREAM_MESSAGES),
    nextBeforeSequence: BeforeSequenceSchema.nullable(),
    hasMoreBefore: z.boolean(),
  })
  .superRefine((response, context) => {
    validatePageMessages(context, response.messages, response.streamId);

    const oldest = response.messages[0];
    const newest = response.messages.at(-1);

    if (oldest === undefined && response.nextBeforeSequence !== null) {
      context.addIssue({
        code: "custom",
        message: "빈 page의 nextBeforeSequence는 null이어야 합니다.",
        path: ["nextBeforeSequence"],
      });
    }

    if (oldest === undefined && response.hasMoreBefore) {
      context.addIssue({
        code: "custom",
        message: "빈 latest page는 hasMoreBefore가 false여야 합니다.",
        path: ["hasMoreBefore"],
      });
    }

    if (oldest !== undefined && response.nextBeforeSequence !== oldest.sequence) {
      context.addIssue({
        code: "custom",
        message: "nextBeforeSequence는 가장 오래된 message sequence여야 합니다.",
        path: ["nextBeforeSequence"],
      });
    }

    if (oldest !== undefined && response.hasMoreBefore !== oldest.sequence > 1) {
      context.addIssue({
        code: "custom",
        message: "latest page의 hasMoreBefore는 가장 오래된 sequence를 반영해야 합니다.",
        path: ["hasMoreBefore"],
      });
    }

    if (newest === undefined && response.throughSequence !== 0) {
      context.addIssue({
        code: "custom",
        message: "비어 있지 않은 stream의 latest page는 비어 있을 수 없습니다.",
        path: ["messages"],
      });
    }

    if (newest !== undefined && newest.sequence !== response.throughSequence) {
      context.addIssue({
        code: "custom",
        message: "latest page의 마지막 message는 throughSequence와 같아야 합니다.",
        path: ["messages"],
      });
    }
  });

export type LatestStreamMessagesResponse = z.infer<typeof LatestStreamMessagesResponseSchema>;

export const LatestStreamMessagesHttpResponseSchema = LatestStreamMessagesResponseSchema;

export type LatestStreamMessagesHttpResponse = LatestStreamMessagesResponse;

export const OlderStreamMessagesResponseSchema = z
  .strictObject({
    streamId: ChannelStreamIdSchema,
    beforeSequence: BeforeSequenceSchema,
    messages: z.array(PublicMessageSchema).max(MAX_STREAM_MESSAGES_PAGE_LIMIT),
    nextBeforeSequence: BeforeSequenceSchema.nullable(),
    hasMoreBefore: z.boolean(),
  })
  .superRefine((response, context) => {
    validatePageMessages(context, response.messages, response.streamId);

    const oldest = response.messages[0];

    if (oldest === undefined) {
      if (response.nextBeforeSequence !== null) {
        context.addIssue({
          code: "custom",
          message: "빈 page의 nextBeforeSequence는 null이어야 합니다.",
          path: ["nextBeforeSequence"],
        });
      }

      if (response.hasMoreBefore) {
        context.addIssue({
          code: "custom",
          message: "빈 older page는 hasMoreBefore가 false여야 합니다.",
          path: ["hasMoreBefore"],
        });
      }

      if (response.beforeSequence !== 1) {
        context.addIssue({
          code: "custom",
          message: "빈 older page의 beforeSequence는 1이어야 합니다.",
          path: ["beforeSequence"],
        });
      }

      return;
    }

    if (response.messages.some((message) => message.sequence >= response.beforeSequence)) {
      context.addIssue({
        code: "custom",
        message: "older page의 모든 message는 beforeSequence보다 작아야 합니다.",
        path: ["messages"],
      });
    }

    if (response.nextBeforeSequence !== oldest.sequence) {
      context.addIssue({
        code: "custom",
        message: "nextBeforeSequence는 가장 오래된 message sequence여야 합니다.",
        path: ["nextBeforeSequence"],
      });
    }

    const newest = response.messages.at(-1);

    if (newest !== undefined && newest.sequence !== response.beforeSequence - 1) {
      context.addIssue({
        code: "custom",
        message: "older page의 마지막 message는 beforeSequence 바로 이전이어야 합니다.",
        path: ["messages"],
      });
    }

    if (response.hasMoreBefore !== oldest.sequence > 1) {
      context.addIssue({
        code: "custom",
        message: "older page의 hasMoreBefore는 가장 오래된 sequence를 반영해야 합니다.",
        path: ["hasMoreBefore"],
      });
    }
  });

export type OlderStreamMessagesResponse = z.infer<typeof OlderStreamMessagesResponseSchema>;

export const OlderStreamMessagesHttpResponseSchema = OlderStreamMessagesResponseSchema;

export type OlderStreamMessagesHttpResponse = OlderStreamMessagesResponse;

export const SyncAfterStreamMessagesResponseSchema = z
  .strictObject({
    streamId: ChannelStreamIdSchema,
    afterSequence: AfterSequenceSchema,
    throughSequence: ThroughSequenceSchema,
    messages: z.array(PublicMessageSchema).max(MAX_STREAM_MESSAGES_PAGE_LIMIT),
    nextAfterSequence: AfterSequenceSchema,
    hasMoreAfter: z.boolean(),
  })
  .superRefine((response, context) => {
    validatePageMessages(context, response.messages, response.streamId);

    if (response.afterSequence > response.throughSequence) {
      context.addIssue({
        code: "custom",
        message: "afterSequence는 throughSequence보다 클 수 없습니다.",
        path: ["afterSequence"],
      });
    }

    const oldest = response.messages[0];
    const newest = response.messages.at(-1);

    for (const message of response.messages) {
      if (
        message.sequence <= response.afterSequence ||
        message.sequence > response.throughSequence
      ) {
        context.addIssue({
          code: "custom",
          message: "sync-after page의 message는 요청 cursor와 watermark 범위 안에 있어야 합니다.",
          path: ["messages"],
        });
        break;
      }
    }

    if (newest === undefined) {
      if (response.afterSequence !== response.throughSequence) {
        context.addIssue({
          code: "custom",
          message: "빈 sync-after page는 cursor가 watermark에 도달한 경우에만 허용됩니다.",
          path: ["messages"],
        });
      }

      if (response.nextAfterSequence !== response.throughSequence) {
        context.addIssue({
          code: "custom",
          message: "빈 final page의 nextAfterSequence는 throughSequence와 같아야 합니다.",
          path: ["nextAfterSequence"],
        });
      }

      if (response.hasMoreAfter) {
        context.addIssue({
          code: "custom",
          message: "빈 sync-after page는 hasMoreAfter가 false여야 합니다.",
          path: ["hasMoreAfter"],
        });
      }

      return;
    }

    if (oldest !== undefined && oldest.sequence !== response.afterSequence + 1) {
      context.addIssue({
        code: "custom",
        message: "sync-after page의 첫 message는 afterSequence 바로 다음이어야 합니다.",
        path: ["messages"],
      });
    }

    if (response.nextAfterSequence !== newest.sequence) {
      context.addIssue({
        code: "custom",
        message: "nextAfterSequence는 마지막 반환 message sequence여야 합니다.",
        path: ["nextAfterSequence"],
      });
    }

    if (!response.hasMoreAfter && response.nextAfterSequence !== response.throughSequence) {
      context.addIssue({
        code: "custom",
        message: "final page의 nextAfterSequence는 throughSequence와 같아야 합니다.",
        path: ["nextAfterSequence"],
      });
    }

    if (response.hasMoreAfter && response.nextAfterSequence >= response.throughSequence) {
      context.addIssue({
        code: "custom",
        message: "후속 page가 있으면 nextAfterSequence는 throughSequence보다 작아야 합니다.",
        path: ["nextAfterSequence"],
      });
    }
  });

export type SyncAfterStreamMessagesResponse = z.infer<typeof SyncAfterStreamMessagesResponseSchema>;

export const InternalSyncAfterStreamMessagesHttpResponseSchema =
  SyncAfterStreamMessagesResponseSchema;

export type InternalSyncAfterStreamMessagesHttpResponse = SyncAfterStreamMessagesResponse;

export const ChatStreamSyncedEventSchema = z
  .strictObject({
    requestId: RequestIdSchema,
    streamId: ChannelStreamIdSchema,
    afterSequence: AfterSequenceSchema,
    throughSequence: ThroughSequenceSchema,
    messages: z.array(PublicMessageSchema).max(MAX_STREAM_MESSAGES_PAGE_LIMIT),
    nextAfterSequence: AfterSequenceSchema,
    hasMoreAfter: z.boolean(),
  })
  .superRefine((event, context) => {
    const parsed = SyncAfterStreamMessagesResponseSchema.safeParse({
      streamId: event.streamId,
      afterSequence: event.afterSequence,
      throughSequence: event.throughSequence,
      messages: event.messages,
      nextAfterSequence: event.nextAfterSequence,
      hasMoreAfter: event.hasMoreAfter,
    });

    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "chat.stream.synced payload가 sync-after response 계약을 만족해야 합니다.",
      });
    }
  });

export type ChatStreamSyncedEvent = z.infer<typeof ChatStreamSyncedEventSchema>;

export type StreamMessagesDomainRejectionCode =
  "stream_unavailable" | "invalid_cursor" | "bad_request" | "rate_limited";

export type StreamMessagesRetryableFailureCode = "stream_messages_unavailable";

export type StreamMessagesErrorCode =
  StreamMessagesDomainRejectionCode | StreamMessagesRetryableFailureCode;

const ErrorMessageSchema = NonBlankStringSchema;
const RetryAfterMsSchema = PositiveSafeIntegerSchema;

export const StreamMessagesHttpErrorResponseSchema = z.discriminatedUnion("code", [
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("stream_unavailable"),
    message: ErrorMessageSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("invalid_cursor"),
    message: ErrorMessageSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("bad_request"),
    message: ErrorMessageSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("rate_limited"),
    message: ErrorMessageSchema,
    retryAfterMs: RetryAfterMsSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    code: z.literal("stream_messages_unavailable"),
    message: ErrorMessageSchema,
    retryable: z.literal(true),
  }),
]);

export type StreamMessagesHttpErrorResponse = z.infer<typeof StreamMessagesHttpErrorResponseSchema>;

export const ChatStreamSyncRejectedEventSchema = z.discriminatedUnion("code", [
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("stream_unavailable"),
  }),
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("invalid_cursor"),
  }),
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("bad_request"),
  }),
  z.strictObject({
    requestId: RequestIdSchema,
    code: z.literal("rate_limited"),
    retryAfterMs: RetryAfterMsSchema,
  }),
]);

export type ChatStreamSyncRejectedEvent = z.infer<typeof ChatStreamSyncRejectedEventSchema>;

export const ChatStreamSyncFailedEventSchema = z.strictObject({
  requestId: RequestIdSchema,
  code: z.literal("stream_messages_unavailable"),
  retryable: z.literal(true),
});

export type ChatStreamSyncFailedEvent = z.infer<typeof ChatStreamSyncFailedEventSchema>;

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

function validatePageMessages(
  context: z.RefinementCtx,
  messages: PublicMessage[],
  streamId: StreamId,
): void {
  let previousSequence: number | undefined;

  for (const message of messages) {
    if (message.streamId !== streamId) {
      context.addIssue({
        code: "custom",
        message: "page의 모든 message는 response streamId와 같아야 합니다.",
        path: ["messages"],
      });
      return;
    }

    if (message.target.type !== "channel") {
      context.addIssue({
        code: "custom",
        message: "Stream Messages 공개 Query는 channel message만 반환할 수 있습니다.",
        path: ["messages"],
      });
      return;
    }

    if (message.streamId !== getCanonicalStreamId(message.target)) {
      context.addIssue({
        code: "custom",
        message: "message target과 streamId는 canonical stream identity와 같아야 합니다.",
        path: ["messages"],
      });
      return;
    }

    if (previousSequence !== undefined && message.sequence !== previousSequence + 1) {
      context.addIssue({
        code: "custom",
        message: "page의 message sequence는 연속적인 오름차순이어야 합니다.",
        path: ["messages"],
      });
      return;
    }

    previousSequence = message.sequence;
  }
}

function measureSerializedEnvelope(utf8ByteLength: number): FinalEnvelopeMeasurement {
  return {
    utf8ByteLength,
    isWithinLimit: utf8ByteLength <= MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  };
}

function toCanonicalPublicMessage(message: PublicMessage): PublicMessage {
  const canonical: PublicMessage = {
    messageId: message.messageId,
    streamId: message.streamId,
    sequence: message.sequence,
    senderActorId: message.senderActorId,
    target: toCanonicalMessageTarget(message.target),
    content: {
      type: "text",
      text: message.content.text,
    },
    createdAt: message.createdAt,
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

export type { ChannelId };
