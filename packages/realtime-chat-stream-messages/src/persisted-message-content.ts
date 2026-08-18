export const PERSISTED_TEXT_MESSAGE_CONTENT_SCHEMA_VERSION = 1;
export const MAX_TEXT_MESSAGE_UTF8_BYTES = 8_192;

export type PersistedTextMessageContent = Readonly<{
  schemaVersion: typeof PERSISTED_TEXT_MESSAGE_CONTENT_SCHEMA_VERSION;
  kind: "text";
  text: string;
}>;

export function parsePersistedTextMessageContent(value: unknown): PersistedTextMessageContent {
  if (!isRecord(value) || !hasExactContentFields(value)) {
    throwInvalidPersistedContent();
  }

  if (
    value.schemaVersion !== PERSISTED_TEXT_MESSAGE_CONTENT_SCHEMA_VERSION ||
    value.kind !== "text" ||
    typeof value.text !== "string" ||
    value.text.length === 0 ||
    value.text !== value.text.trim() ||
    getUtf8ByteLength(value.text) > MAX_TEXT_MESSAGE_UTF8_BYTES
  ) {
    throwInvalidPersistedContent();
  }

  return {
    schemaVersion: PERSISTED_TEXT_MESSAGE_CONTENT_SCHEMA_VERSION,
    kind: "text",
    text: value.text,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactContentFields(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === 3 &&
    Object.hasOwn(value, "schemaVersion") &&
    Object.hasOwn(value, "kind") &&
    Object.hasOwn(value, "text")
  );
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function throwInvalidPersistedContent(): never {
  throw new Error("저장된 text message content가 canonical schema와 일치하지 않습니다.");
}
