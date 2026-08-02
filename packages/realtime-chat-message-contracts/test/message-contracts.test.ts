import { describe, expect, it } from "vitest";

import {
  ChatMessageSchema,
  getCanonicalStreamId,
  getUtf8ByteLength,
  MAX_TEXT_UTF8_BYTES,
  MessageTextSchema,
} from "../src/index";

describe("chat message contracts", () => {
  it("accepts text at the UTF-8 8,192 byte boundary", () => {
    const text = `${"가".repeat(2_729)}😀a`;

    expect(getUtf8ByteLength(text)).toBe(MAX_TEXT_UTF8_BYTES);
    expect(MessageTextSchema.safeParse(text).success).toBe(true);
  });

  it("rejects text beyond the UTF-8 8,192 byte boundary", () => {
    const text = `${"가".repeat(2_729)}😀aa`;

    expect(getUtf8ByteLength(text)).toBe(MAX_TEXT_UTF8_BYTES + 1);
    expect(MessageTextSchema.safeParse(text).success).toBe(false);
  });

  it("accepts only the server-confirmed ChatMessage shape", () => {
    const message = {
      messageId: "message-1",
      streamId: "channel:channel-1",
      sequence: 1,
      senderActorId: "actor-1",
      target: {
        type: "channel",
        channelId: "channel-1",
      },
      text: "hello",
      createdAt: "2026-07-16T00:00:00.000Z",
    };

    expect(ChatMessageSchema.safeParse(message).success).toBe(true);
    expect(
      ChatMessageSchema.safeParse({
        ...message,
        idempotencyKey: "idempotency-1",
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({
        ...message,
        sentAtClient: "2026-07-16T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({
        ...message,
        text: undefined,
        content: {
          type: "text",
          text: "hello",
        },
      }).success,
    ).toBe(false);
  });

  it("derives the canonical stream ID from every target variant", () => {
    expect(
      getCanonicalStreamId({
        type: "channel",
        channelId: "channel-1",
      }),
    ).toBe("channel:channel-1");
    expect(
      getCanonicalStreamId({
        type: "dm",
        dmConversationId: "dm-1",
      }),
    ).toBe("dm:dm-1");
    expect(
      getCanonicalStreamId({
        type: "thread",
        threadId: "thread-1",
      }),
    ).toBe("thread:thread-1");
  });
});
