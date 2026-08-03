import {
  getCanonicalStreamId,
  getUtf8ByteLength,
  MAX_TEXT_UTF8_BYTES,
  PublicMessageSchema,
  TextMessageContentSchema,
} from "../src/index";
import { describe, expect, it } from "vitest";

describe("public message contracts", () => {
  it("accepts a multilingual and emoji text value at the UTF-8 8,192 byte boundary", () => {
    const text = `${"가".repeat(2_729)}😀a`;

    expect(getUtf8ByteLength(text)).toBe(MAX_TEXT_UTF8_BYTES);
    expect(
      TextMessageContentSchema.safeParse({
        type: "text",
        text,
      }).success,
    ).toBe(true);
  });

  it("rejects a multilingual and emoji text value at the UTF-8 8,193 byte boundary", () => {
    const text = `${"가".repeat(2_729)}😀aa`;

    expect(getUtf8ByteLength(text)).toBe(MAX_TEXT_UTF8_BYTES + 1);
    expect(
      TextMessageContentSchema.safeParse({
        type: "text",
        text,
      }).success,
    ).toBe(false);
  });

  it("rejects clientMessageId and unsupported content variants from PublicMessage", () => {
    expect(
      PublicMessageSchema.safeParse({
        messageId: "message-1",
        streamId: "channel:channel-1",
        sequence: 1,
        senderActorId: "actor-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
        createdAt: "2026-07-16T00:00:00.000Z",
        clientMessageId: "client-message-1",
      }).success,
    ).toBe(false);

    expect(
      TextMessageContentSchema.safeParse({
        type: "system",
        text: "system message",
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
