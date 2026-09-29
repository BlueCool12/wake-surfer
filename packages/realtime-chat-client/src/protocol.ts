import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import { RealtimeChatClientError } from "./realtime-chat-client-error.js";
import type { ChatTarget } from "./types.js";

export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}
export function parse<T>(schema: Schema<T>, value: unknown, code = "protocol_failure"): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RealtimeChatClientError(code, { cause: result.error });
  return result.data;
}
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new RealtimeChatClientError("protocol_failure", { cause });
  }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function copyTarget(target: ChatTarget): ChatTarget {
  const id =
    target?.type === "channel"
      ? target.channelId
      : target?.type === "thread"
        ? target.threadId
        : undefined;
  if (typeof id !== "string" || !id || id.trim() !== id) {
    throw new RealtimeChatClientError("bad_request");
  }
  return Object.freeze(
    target.type === "channel"
      ? { type: "channel", channelId: id }
      : { type: "thread", threadId: id },
  );
}
export function targetKey(target: ChatTarget): string {
  return target.type + ":" + (target.type === "channel" ? target.channelId : target.threadId);
}
export function targetFields(target: ChatTarget): { channelId: string } | { threadId: string } {
  return target.type === "channel"
    ? { channelId: target.channelId }
    : { threadId: target.threadId };
}
export function sameTarget(expected: ChatTarget, actual: PublicMessage["target"]): boolean {
  return actual.type !== "dm" && targetKey(expected) === targetKey(actual);
}
export function assertMessageTarget(
  target: ChatTarget,
  message: Pick<PublicMessage, "target" | "streamId">,
): void {
  if (!sameTarget(target, message.target) || message.streamId !== targetKey(target)) {
    throw new RealtimeChatClientError("protocol_failure");
  }
}
export function validatePage<T extends { streamId: string; messages: PublicMessage[] }>(
  target: ChatTarget,
  response: T,
): T {
  if (response.streamId !== targetKey(target))
    throw new RealtimeChatClientError("protocol_failure");
  for (const message of response.messages) assertMessageTarget(target, message);
  return response;
}
