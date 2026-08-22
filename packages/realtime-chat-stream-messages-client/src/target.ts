import {
  getCanonicalStreamId,
  type MessageTarget,
} from "@wake-surfer/realtime-chat-message-contracts";

export type StreamMessagesClientTarget = Exclude<MessageTarget, { type: "dm" }>;

export function copyStreamMessagesClientTarget(
  target: StreamMessagesClientTarget,
): StreamMessagesClientTarget {
  assertStreamMessagesClientTarget(target);

  return target.type === "channel"
    ? { type: "channel", channelId: target.channelId }
    : { type: "thread", threadId: target.threadId };
}

export function getStreamMessagesClientTargetKey(target: StreamMessagesClientTarget): string {
  assertStreamMessagesClientTarget(target);
  return getCanonicalStreamId(target);
}

export function streamMessagesClientTargetsEqual(
  left: StreamMessagesClientTarget,
  right: MessageTarget,
): boolean {
  return left.type === "channel"
    ? right.type === "channel" && left.channelId === right.channelId
    : right.type === "thread" && left.threadId === right.threadId;
}

function assertStreamMessagesClientTarget(target: StreamMessagesClientTarget): void {
  const id = target.type === "channel" ? target.channelId : target.threadId;

  if (id.trim().length === 0 || id !== id.trim()) {
    throw new TypeError("Stream Messages target ID는 공백 없는 문자열이어야 합니다.");
  }
}
