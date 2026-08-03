import { z } from "zod";

const MAX_TEXT_UTF8_BYTES = 8_192;
const NonBlankStringSchema = z.string().trim().min(1);
const ISODateTimeSchema = z
  .string()
  .trim()
  .pipe(z.iso.datetime({ offset: true }));
const IdempotencyKeySchema = z
  .string()
  .min(1)
  .refine(
    (idempotencyKey) => idempotencyKey.trim() === idempotencyKey,
    "idempotencyKey 앞뒤에는 공백을 사용할 수 없습니다.",
  );
const AcceptedMessageTextSchema = NonBlankStringSchema.refine(
  (text) => getUtf8ByteLength(text) <= MAX_TEXT_UTF8_BYTES,
  `메시지 text는 UTF-8 ${MAX_TEXT_UTF8_BYTES} byte 이하여야 합니다.`,
);

export type SendMessageTarget =
  | {
      type: "channel";
      channelId: string;
    }
  | {
      type: "dm";
      dmConversationId: string;
    }
  | {
      type: "thread";
      threadId: string;
    };

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

export type SendMessageRequest = {
  idempotencyKey: string;
  target: SendMessageTarget;
  text: string;
};

export const SendMessageRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  target: SendMessageTargetSchema,
  text: z.string(),
});

export type SendMessageRequestParseResult =
  | {
      ok: true;
      value: SendMessageRequest;
    }
  | {
      ok: false;
      message: string;
    };

export function parseSendMessageRequest(body: unknown): SendMessageRequestParseResult {
  const parsed = SendMessageRequestSchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      message: "메시지 전송 요청 본문이 올바르지 않습니다.",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export type AcceptedTextMessage = {
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
  target: SendMessageTarget;
  text: string;
  createdAt: string;
};

export const AcceptedTextMessageSchema = z.strictObject({
  messageId: NonBlankStringSchema,
  streamId: NonBlankStringSchema,
  sequence: z.number().int().safe().positive(),
  senderActorId: NonBlankStringSchema,
  target: SendMessageTargetSchema,
  text: AcceptedMessageTextSchema,
  createdAt: ISODateTimeSchema,
});

export type SendMessageRejectedReason =
  | "invalid_text"
  | "target_not_found"
  | "write_forbidden"
  | "idempotency_conflict";

export type SendMessageResponse =
  | {
      status: "accepted";
      idempotencyKey: string;
      message: AcceptedTextMessage;
    }
  | {
      status: "rejected";
      idempotencyKey: string;
      reason: SendMessageRejectedReason;
    };

export const SendMessageResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    idempotencyKey: IdempotencyKeySchema,
    message: AcceptedTextMessageSchema,
  }),
  z.strictObject({
    status: z.literal("rejected"),
    idempotencyKey: IdempotencyKeySchema,
    reason: z.enum(["invalid_text", "target_not_found", "write_forbidden", "idempotency_conflict"]),
  }),
]);

export type OutboundMessageDeliveryRequested = {
  eventId: string;
  occurredAt: string;
  message: AcceptedTextMessage;
  recipientActorIds: string[];
};

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
