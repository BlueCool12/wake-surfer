import { getCanonicalStreamId } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  ChannelId,
  ChatMessage,
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

export function validatePageMessages(
  context: z.RefinementCtx,
  messages: ChatMessage[],
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

export type { ChannelId };
