import { PublicMessageSchema } from "@wake-surfer/realtime-chat-message-contracts";
import { z } from "zod";

import {
  BeforeSequenceSchema,
  ChannelIdSchema,
  DEFAULT_STREAM_MESSAGES_PAGE_LIMIT,
  MAX_STREAM_MESSAGES_PAGE_LIMIT,
  MessageStreamIdSchema,
  PageLimitSchema,
  validatePageMessages,
} from "./common.js";

export const OlderStreamMessagesHttpRequestSchema = z.strictObject({
  channelId: ChannelIdSchema,
  beforeSequence: BeforeSequenceSchema,
  limit: PageLimitSchema.default(DEFAULT_STREAM_MESSAGES_PAGE_LIMIT),
});

export type OlderStreamMessagesHttpRequest = z.infer<typeof OlderStreamMessagesHttpRequestSchema>;

export const OlderStreamMessagesResponseSchema = z
  .strictObject({
    streamId: MessageStreamIdSchema,
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
