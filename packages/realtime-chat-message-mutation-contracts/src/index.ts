import { z } from "zod";

const MessageIdSchema = z.string().trim().min(1);

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
