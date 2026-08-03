import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import { describe, expect, it } from "vitest";

import {
  getChatStreamSyncedEventUtf8ByteLength,
  getLatestStreamMessagesHttpResponseUtf8ByteLength,
  getOlderStreamMessagesHttpResponseUtf8ByteLength,
  MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  measureOlderStreamMessagesHttpFinalEnvelope,
  serializeChatStreamSyncedEvent,
  serializeLatestStreamMessagesHttpResponse,
  serializeOlderStreamMessagesHttpResponse,
} from "../src/index";
import type { ChatStreamSyncedEvent } from "../src/index";
import { createLatestResponse, createMessage } from "./fixtures";

describe("canonical final envelopes", () => {
  it("has stable serialization and UTF-8 byte measurement for the same value", () => {
    const latest = createLatestResponse([createMessage(1, "가😀")]);
    const event: ChatStreamSyncedEvent = {
      requestId: "request-1",
      streamId: "channel:channel-1",
      afterSequence: 0,
      throughSequence: 1,
      messages: [createMessage(1, "가😀")],
      nextAfterSequence: 1,
      hasMoreAfter: false,
    };

    const first = serializeChatStreamSyncedEvent(event);
    const second = serializeChatStreamSyncedEvent(event);
    const latestFirst = serializeLatestStreamMessagesHttpResponse(latest);
    const latestSecond = serializeLatestStreamMessagesHttpResponse(latest);

    expect(first).toBe(second);
    expect(latestFirst).toBe(latestSecond);
    expect(getChatStreamSyncedEventUtf8ByteLength(event)).toBe(
      new TextEncoder().encode(first).byteLength,
    );
    expect(getLatestStreamMessagesHttpResponseUtf8ByteLength(latest)).toBe(
      new TextEncoder().encode(latestFirst).byteLength,
    );
  });

  it("measures the 49,152 and 49,153 byte older HTTP envelope boundaries", () => {
    const messages = Array.from({ length: 6 }, (_, index) => createMessage(index + 1, "x"));
    const createOlderResponse = (page: PublicMessage[]) => ({
      streamId: "channel:channel-1",
      beforeSequence: 7,
      messages: page,
      nextBeforeSequence: page[0]?.sequence ?? null,
      hasMoreBefore: false,
    });
    const base = getOlderStreamMessagesHttpResponseUtf8ByteLength(createOlderResponse(messages));
    let remaining = MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES - base;

    for (const message of messages) {
      const extra = Math.min(remaining, 8_191);
      message.content.text += "x".repeat(extra);
      remaining -= extra;
    }

    const atLimit = createOlderResponse(messages);
    expect(remaining).toBe(0);
    expect(getOlderStreamMessagesHttpResponseUtf8ByteLength(atLimit)).toBe(
      MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
    );
    expect(measureOlderStreamMessagesHttpFinalEnvelope(atLimit).isWithinLimit).toBe(true);

    const overLimit = createOlderResponse(
      messages.map((message, index) =>
        index === messages.length - 1
          ? {
              ...message,
              content: {
                ...message.content,
                text: `${message.content.text}x`,
              },
            }
          : message,
      ),
    );

    expect(getOlderStreamMessagesHttpResponseUtf8ByteLength(overLimit)).toBe(
      MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES + 1,
    );
    expect(measureOlderStreamMessagesHttpFinalEnvelope(overLimit).isWithinLimit).toBe(false);
    expect(serializeOlderStreamMessagesHttpResponse(atLimit)).not.toBe(
      serializeOlderStreamMessagesHttpResponse(overLimit),
    );
  });
});
