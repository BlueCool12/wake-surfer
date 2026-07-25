import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";

import type { LatestStreamMessagesResponse } from "../src/index";

export function createMessage(sequence: number, text = "message"): PublicMessage {
  return {
    messageId: `message-${sequence}`,
    streamId: "channel:channel-1",
    sequence,
    senderActorId: "actor-1",
    target: {
      type: "channel",
      channelId: "channel-1",
    },
    content: {
      type: "text",
      text,
    },
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

export function createLatestResponse(messages: PublicMessage[]): LatestStreamMessagesResponse {
  return {
    streamId: "channel:channel-1",
    throughSequence: messages.at(-1)?.sequence ?? 0,
    messages,
    nextBeforeSequence: messages[0]?.sequence ?? null,
    hasMoreBefore: false,
  };
}
