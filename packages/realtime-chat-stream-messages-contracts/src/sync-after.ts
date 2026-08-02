import { ChatMessageSchema } from "@wake-surfer/realtime-chat-message-contracts";
import { z } from "zod";

import {
  AfterSequenceSchema,
  ChannelIdSchema,
  ChannelStreamIdSchema,
  DEFAULT_STREAM_MESSAGES_PAGE_LIMIT,
  MAX_STREAM_MESSAGES_PAGE_LIMIT,
  PageLimitSchema,
  RequestIdSchema,
  ThroughSequenceSchema,
  validatePageMessages,
} from "./common.js";

const SyncAfterCursorSchema = z
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

export const SyncAfterStreamMessagesRequestSchema = SyncAfterCursorSchema;

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

export const SyncAfterStreamMessagesResponseSchema = z
  .strictObject({
    streamId: ChannelStreamIdSchema,
    afterSequence: AfterSequenceSchema,
    throughSequence: ThroughSequenceSchema,
    messages: z.array(ChatMessageSchema).max(MAX_STREAM_MESSAGES_PAGE_LIMIT),
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
    messages: z.array(ChatMessageSchema).max(MAX_STREAM_MESSAGES_PAGE_LIMIT),
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
