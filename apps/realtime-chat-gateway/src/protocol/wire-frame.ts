export type WireFrame = {
  payload: Record<string, unknown>;
  type: string;
};

export function parseWireFrame(rawFrame: string): WireFrame | null {
  let value: unknown;

  try {
    value = JSON.parse(rawFrame) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== "string" || value.type.trim() !== value.type) {
    return null;
  }

  const { type, ...payload } = value;

  if (type.length === 0) {
    return null;
  }

  return { payload, type };
}

export function serializeWireFrame(type: string, payload: Record<string, unknown>): string {
  if (
    type.trim().length === 0 ||
    type.trim() !== type ||
    Object.prototype.hasOwnProperty.call(payload, "type")
  ) {
    throw new TypeError("WebSocket event type과 payload가 올바르지 않습니다.");
  }

  return JSON.stringify({ type, ...payload });
}

export function parseRawPayload(rawPayload: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(rawPayload) as unknown;
  } catch {
    throw new TypeError("Gateway relay payload는 JSON 객체여야 합니다.");
  }

  if (!isRecord(value) || Object.prototype.hasOwnProperty.call(value, "type")) {
    throw new TypeError("Gateway relay payload는 type 필드가 없는 JSON 객체여야 합니다.");
  }

  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
