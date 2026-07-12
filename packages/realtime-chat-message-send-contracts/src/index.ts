import { z } from "zod";

export type ActorId = string;
export type ChannelId = string;
export type ClientMessageId = string;
export type CommandId = string;
export type DmConversationId = string;
export type ISODateTime = string;
export type MessageId = string;
export type Sequence = number;
export type StreamId = string;
export type ThreadId = string;

export type SendMessageTarget =
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

export type TextMessageContent = {
  type: "text";
  text: string;
};

export type SendMessageContent = TextMessageContent;

export type SendMessageRequest = {
  commandId?: CommandId;
  clientMessageId: ClientMessageId;
  target: SendMessageTarget;
  content: SendMessageContent;
  sentAtClient?: ISODateTime;
};

const NonBlankStringSchema = z.string().trim().min(1);
const ISODateTimeSchema = z
  .string()
  .trim()
  .pipe(z.iso.datetime({ offset: true }));

export const SendMessageTargetSchema = z.discriminatedUnion("type", [
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

export const SendMessageContentSchema = z.strictObject({
  type: z.literal("text"),
  text: NonBlankStringSchema,
});

export const SendMessageRequestBodySchema = z.strictObject({
  commandId: NonBlankStringSchema.optional(),
  clientMessageId: NonBlankStringSchema,
  target: SendMessageTargetSchema,
  content: SendMessageContentSchema,
  sentAtClient: ISODateTimeSchema.optional(),
});

export type SendMessageRequestBodyParseResult =
  | {
      ok: true;
      value: SendMessageRequest;
    }
  | {
      ok: false;
      message: string;
    };

export function parseSendMessageRequestBody(body: unknown): SendMessageRequestBodyParseResult {
  const parsed = SendMessageRequestBodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      message: "메시지 전송 요청 본문이 올바르지 않습니다.",
    };
  }

  return {
    ok: true,
    value: removeUndefinedOptionalFields(parsed.data),
  };
}

function removeUndefinedOptionalFields(
  input: z.infer<typeof SendMessageRequestBodySchema>,
): SendMessageRequest {
  const value: SendMessageRequest = {
    clientMessageId: input.clientMessageId,
    target: input.target,
    content: input.content,
  };

  if (input.commandId !== undefined) {
    value.commandId = input.commandId;
  }

  if (input.sentAtClient !== undefined) {
    value.sentAtClient = input.sentAtClient;
  }

  return value;
}

export type PublicMessage = {
  messageId: MessageId;
  streamId: StreamId;
  sequence: Sequence;
  senderActorId: ActorId;
  target: SendMessageTarget;
  content: SendMessageContent;
  createdAt: ISODateTime;
  sentAtClient?: ISODateTime;
};

export type SendMessageRejectedReason = "invalid_content" | "target_not_found" | "write_forbidden";

export type SendMessageResponse =
  | {
      status: "accepted";
      commandId?: CommandId;
      clientMessageId: ClientMessageId;
      message: PublicMessage;
    }
  | {
      status: "rejected";
      commandId?: CommandId;
      clientMessageId: ClientMessageId;
      reason: SendMessageRejectedReason;
    };

export type OutboundMessageDeliveryRequested = {
  eventId: string;
  occurredAt: ISODateTime;
  message: PublicMessage;
  recipientActorIds: ActorId[];
};
