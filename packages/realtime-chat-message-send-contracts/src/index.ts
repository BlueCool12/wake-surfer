import {
  MessageTargetSchema,
  TextMessageContentSchema,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  ActorId,
  ISODateTime,
  MessageTarget,
  PublicMessage,
  TextMessageContent,
} from "@wake-surfer/realtime-chat-message-contracts";
import { z } from "zod";

export type {
  ActorId,
  ChannelId,
  DmConversationId,
  ISODateTime,
  MessageId,
  MessageTarget,
  PublicMessage,
  Sequence,
  StreamId,
  TextMessageContent,
  ThreadId,
} from "@wake-surfer/realtime-chat-message-contracts";

export type ClientMessageId = string;
export type CommandId = string;

export type SendMessageTarget = MessageTarget;
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

export const SendMessageTargetSchema = MessageTargetSchema;
export const SendMessageContentSchema = TextMessageContentSchema;

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
