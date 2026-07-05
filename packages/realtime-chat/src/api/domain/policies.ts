import type { RealtimeChatMessageTarget } from "../runtime-deps";

export function buildUserMessageIdempotencyKey(
  senderId: string,
  target: RealtimeChatMessageTarget,
  clientMessageId: string,
): string {
  return `USER_MESSAGE:${senderId}:${targetKey(target)}:${clientMessageId}`;
}

export function targetKey(target: RealtimeChatMessageTarget): string {
  if (target.kind === "channel") {
    return `CHANNEL:${target.workspaceId}:${target.channelId}`;
  }

  if (target.kind === "dm") {
    return `DM:${target.dmConversationId}`;
  }

  return `THREAD:${target.threadId}`;
}
