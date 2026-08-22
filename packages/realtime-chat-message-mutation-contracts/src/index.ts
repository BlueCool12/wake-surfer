import { MessageTargetSchema } from "@wake-surfer/realtime-chat-message-contracts";
import { z } from "zod";

const MessageIdSchema = z.string().trim().min(1);
const NonBlankStringSchema = z.string().trim().min(1);
const ISODateTimeSchema = z
  .string()
  .trim()
  .pipe(z.iso.datetime({ offset: true }));

export const EditMessageRequestSchema = z.strictObject({
  messageId: MessageIdSchema,
  text: z.string(),
});

export type EditMessageRequest = z.infer<typeof EditMessageRequestSchema>;

export type EditMessageRequestParseResult =
  | {
      ok: true;
      value: EditMessageRequest;
    }
  | {
      ok: false;
      message: string;
    };

export function parseEditMessageRequest(input: unknown): EditMessageRequestParseResult {
  const parsed = EditMessageRequestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "메시지 수정 요청 형식이 올바르지 않습니다.",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export const DeleteMessageRequestSchema = z.strictObject({
  messageId: MessageIdSchema,
});

export type DeleteMessageRequest = z.infer<typeof DeleteMessageRequestSchema>;

export type DeleteMessageRequestParseResult =
  | {
      ok: true;
      value: DeleteMessageRequest;
    }
  | {
      ok: false;
      message: string;
    };

export function parseDeleteMessageRequest(input: unknown): DeleteMessageRequestParseResult {
  const parsed = DeleteMessageRequestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "메시지 삭제 요청 형식이 올바르지 않습니다.",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export const EditedTextMessageSchema = z.strictObject({
  messageId: MessageIdSchema,
  streamId: NonBlankStringSchema,
  sequence: z.number().int().safe().positive(),
  senderActorId: NonBlankStringSchema,
  target: MessageTargetSchema,
  version: z.number().int().safe().positive(),
  text: NonBlankStringSchema,
  createdAt: ISODateTimeSchema,
  editedAt: ISODateTimeSchema,
});

export type EditedTextMessage = z.infer<typeof EditedTextMessageSchema>;

export const DeletedMessageSchema = z.strictObject({
  messageId: MessageIdSchema,
  streamId: NonBlankStringSchema,
  sequence: z.number().int().safe().positive(),
  senderActorId: NonBlankStringSchema,
  target: MessageTargetSchema,
  version: z.number().int().safe().positive(),
  createdAt: ISODateTimeSchema,
  deletedAt: ISODateTimeSchema,
});

export type DeletedMessage = z.infer<typeof DeletedMessageSchema>;

export const EditMessageResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    message: EditedTextMessageSchema,
  }),
  z.strictObject({
    status: z.literal("rejected"),
    reason: z.enum(["invalid_content", "write_forbidden"]),
  }),
  z.strictObject({
    status: z.literal("rejected"),
    reason: z.literal("message_deleted"),
    message: DeletedMessageSchema,
  }),
]);

export type EditMessageResponse = z.infer<typeof EditMessageResponseSchema>;

export const DeleteMessageResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    message: DeletedMessageSchema,
  }),
  z.strictObject({
    status: z.literal("rejected"),
    reason: z.literal("write_forbidden"),
  }),
]);

export type DeleteMessageResponse = z.infer<typeof DeleteMessageResponseSchema>;
