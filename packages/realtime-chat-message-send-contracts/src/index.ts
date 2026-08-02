import {
  ChatMessageSchema,
  MessageTargetSchema,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  ActorId,
  ChatMessage,
  ISODateTime,
  MessageTarget,
} from "@wake-surfer/realtime-chat-message-contracts";
import { z } from "zod";

export type SendMessageRequest = {
  idempotencyKey: string;
  target: MessageTarget;
  text: string;
};

const IdempotencyKeySchema = z
  .string()
  .min(1)
  .refine(
    (idempotencyKey) => idempotencyKey.trim() === idempotencyKey,
    "idempotencyKey 앞뒤에는 공백을 사용할 수 없습니다.",
  );

export const SendMessageRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  target: MessageTargetSchema,
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

export type SendMessageRejectedReason =
  "invalid_text" | "target_not_found" | "write_forbidden" | "idempotency_conflict";

export type SendMessageResponse =
  | {
      status: "accepted";
      idempotencyKey: string;
      message: ChatMessage;
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
    message: ChatMessageSchema,
  }),
  z.strictObject({
    status: z.literal("rejected"),
    idempotencyKey: IdempotencyKeySchema,
    reason: z.enum(["invalid_text", "target_not_found", "write_forbidden", "idempotency_conflict"]),
  }),
]);

export type OutboundMessageDeliveryRequested = {
  eventId: string;
  occurredAt: ISODateTime;
  message: ChatMessage;
  recipientActorIds: ActorId[];
};
