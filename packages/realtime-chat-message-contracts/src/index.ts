import { z } from "zod";

export type ActorId = string;
export type ChannelId = string;
export type DmConversationId = string;
export type ISODateTime = string;
export type MessageId = string;
export type Sequence = number;
export type StreamId = string;
export type ThreadId = string;

export const MAX_TEXT_UTF8_BYTES = 8_192;

export type MessageTarget =
  | {
      type: "channel";
      channelId: ChannelId;
    }
  | {
      type: "dm";
      dmConversationId: DmConversationId;
    }
  | {
      type: "thread";
      threadId: ThreadId;
    };

export type ChatMessage = {
  messageId: MessageId;
  streamId: StreamId;
  sequence: Sequence;
  senderActorId: ActorId;
  target: MessageTarget;
  text: string;
  createdAt: ISODateTime;
};

const NonBlankStringSchema = z.string().trim().min(1);
const ISODateTimeSchema = z
  .string()
  .trim()
  .pipe(z.iso.datetime({ offset: true }));

export const MessageTargetSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("channel"),
    channelId: NonBlankStringSchema,
  }),
  z.strictObject({
    type: z.literal("dm"),
    dmConversationId: NonBlankStringSchema,
  }),
  z.strictObject({
    type: z.literal("thread"),
    threadId: NonBlankStringSchema,
  }),
]);

export const MessageTextSchema = NonBlankStringSchema.refine(
  (text) => getUtf8ByteLength(text) <= MAX_TEXT_UTF8_BYTES,
  `메시지 text는 UTF-8 ${MAX_TEXT_UTF8_BYTES} byte 이하여야 합니다.`,
);

export const ChatMessageSchema = z.strictObject({
  messageId: NonBlankStringSchema,
  streamId: NonBlankStringSchema,
  sequence: z.number().int().safe().positive(),
  senderActorId: NonBlankStringSchema,
  target: MessageTargetSchema,
  text: MessageTextSchema,
  createdAt: ISODateTimeSchema,
});

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function getMessageTargetType(target: MessageTarget): MessageTarget["type"] {
  return target.type;
}

export function getMessageTargetId(target: MessageTarget): string {
  switch (target.type) {
    case "channel":
      return target.channelId;
    case "dm":
      return target.dmConversationId;
    case "thread":
      return target.threadId;
  }
}

export function getCanonicalStreamId(target: MessageTarget): StreamId {
  return `${getMessageTargetType(target)}:${getMessageTargetId(target)}`;
}
