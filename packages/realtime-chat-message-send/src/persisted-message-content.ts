import { z } from "zod";

export const PERSISTED_TEXT_MESSAGE_CONTENT_SCHEMA_VERSION = 1;
export const MAX_TEXT_MESSAGE_UTF8_BYTES = 8_192;

export const PersistedTextMessageContentSchema = z.strictObject({
  schemaVersion: z.literal(PERSISTED_TEXT_MESSAGE_CONTENT_SCHEMA_VERSION),
  kind: z.literal("text"),
  text: z
    .string()
    .min(1)
    .refine((text) => text === text.trim())
    .refine((text) => getUtf8ByteLength(text) <= MAX_TEXT_MESSAGE_UTF8_BYTES),
});

export type PersistedTextMessageContent = Readonly<
  z.infer<typeof PersistedTextMessageContentSchema>
>;

export function createPersistedTextMessageContent(text: string): PersistedTextMessageContent {
  return parsePersistedTextMessageContent({
    schemaVersion: PERSISTED_TEXT_MESSAGE_CONTENT_SCHEMA_VERSION,
    kind: "text",
    text,
  });
}

export function parsePersistedTextMessageContent(value: unknown): PersistedTextMessageContent {
  const result = PersistedTextMessageContentSchema.safeParse(value);

  if (!result.success) {
    throw new Error("저장된 text message content가 canonical schema와 일치하지 않습니다.", {
      cause: result.error,
    });
  }

  return result.data;
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
