import { PublicMessageSchema } from "@wake-surfer/realtime-chat-message-contracts";
import { z } from "zod";

import {
  BeforeSequenceSchema,
  ChannelIdSchema,
  MAX_LATEST_STREAM_MESSAGES,
  MessageStreamIdSchema,
  ThreadIdSchema,
  ThroughSequenceSchema,
  validatePageMessages,
} from "./common.js";

export const LatestStreamMessagesHttpRequestSchema = z.strictObject({
  channelId: ChannelIdSchema,
});

export type LatestStreamMessagesHttpRequest = z.infer<typeof LatestStreamMessagesHttpRequestSchema>;

export const LatestThreadStreamMessagesHttpRequestSchema = z.strictObject({
  threadId: ThreadIdSchema,
});

export type LatestThreadStreamMessagesHttpRequest = z.infer<
  typeof LatestThreadStreamMessagesHttpRequestSchema
>;

export const LatestStreamMessagesResponseSchema = z
  .strictObject({
    streamId: MessageStreamIdSchema,
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
