import {
  ChatStreamSyncEventSchema,
  ChatStreamSyncFailedEventSchema,
  ChatStreamSyncRejectedEventSchema,
  ChatStreamSyncedEventSchema,
  DEFAULT_STREAM_MESSAGES_PAGE_LIMIT,
  getChatStreamSyncedEventUtf8ByteLength,
  getLatestStreamMessagesHttpResponseUtf8ByteLength,
  getOlderStreamMessagesHttpResponseUtf8ByteLength,
  LatestStreamMessagesHttpRequestSchema,
  LatestStreamMessagesResponseSchema,
  MAX_REQUEST_ID_LENGTH,
  MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES,
  measureOlderStreamMessagesHttpFinalEnvelope,
  OlderStreamMessagesHttpRequestSchema,
  OlderStreamMessagesResponseSchema,
  serializeChatStreamSyncedEvent,
  serializeLatestStreamMessagesHttpResponse,
  serializeOlderStreamMessagesHttpResponse,
  StreamMessagesHttpErrorResponseSchema,
  SyncAfterStreamMessagesRequestSchema,
} from "../src/index";
import type { ChatStreamSyncedEvent, LatestStreamMessagesResponse } from "../src/index";
import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import { describe, expect, it } from "vitest";

function createMessage(sequence: number, text = "message"): PublicMessage {
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

function createLatestResponse(messages: PublicMessage[]): LatestStreamMessagesResponse {
  return {
    streamId: "channel:channel-1",
    throughSequence: messages.at(-1)?.sequence ?? 0,
    messages,
    nextBeforeSequence: messages[0]?.sequence ?? null,
    hasMoreBefore: false,
  };
}

describe("stream message request contracts", () => {
  it("does not accept a client limit or cursor on latest", () => {
    expect(
      LatestStreamMessagesHttpRequestSchema.safeParse({
        channelId: "channel-1",
        limit: 50,
      }).success,
    ).toBe(false);
    expect(
      LatestStreamMessagesHttpRequestSchema.safeParse({
        channelId: "channel-1",
        beforeSequence: 1,
      }).success,
    ).toBe(false);
  });

  it("defaults older and after limits to 50 and rejects 101", () => {
    expect(
      OlderStreamMessagesHttpRequestSchema.parse({
        channelId: "channel-1",
        beforeSequence: 1,
      }).limit,
    ).toBe(DEFAULT_STREAM_MESSAGES_PAGE_LIMIT);
    expect(
      SyncAfterStreamMessagesRequestSchema.parse({
        channelId: "channel-1",
        afterSequence: 0,
      }).limit,
    ).toBe(DEFAULT_STREAM_MESSAGES_PAGE_LIMIT);
    expect(
      OlderStreamMessagesHttpRequestSchema.safeParse({
        channelId: "channel-1",
        beforeSequence: 1,
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      SyncAfterStreamMessagesRequestSchema.safeParse({
        channelId: "channel-1",
        afterSequence: 0,
        throughSequence: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      OlderStreamMessagesHttpRequestSchema.safeParse({
        channelId: "channel-1",
        beforeSequence: 1,
        limit: 1.5,
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe, fractional, invalid, and client-owned actor values", () => {
    for (const beforeSequence of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        OlderStreamMessagesHttpRequestSchema.safeParse({
          channelId: "channel-1",
          beforeSequence,
        }).success,
      ).toBe(false);
    }

    expect(
      ChatStreamSyncEventSchema.safeParse({
        requestId: "request-1",
        channelId: "channel-1",
        afterSequence: -1,
      }).success,
    ).toBe(false);
    expect(
      ChatStreamSyncEventSchema.safeParse({
        requestId: "request-1",
        channelId: "channel-1",
        afterSequence: 0,
        actorId: "untrusted-client-actor",
      }).success,
    ).toBe(false);
  });

  it("limits WebSocket request IDs to 128 characters", () => {
    expect(
      ChatStreamSyncEventSchema.safeParse({
        requestId: "a".repeat(MAX_REQUEST_ID_LENGTH),
        channelId: "channel-1",
        afterSequence: 0,
      }).success,
    ).toBe(true);
    expect(
      ChatStreamSyncEventSchema.safeParse({
        requestId: "a".repeat(MAX_REQUEST_ID_LENGTH + 1),
        channelId: "channel-1",
        afterSequence: 0,
      }).success,
    ).toBe(false);

    const requestIdWithWhitespace = " request-1 ";
    expect(
      ChatStreamSyncEventSchema.parse({
        requestId: requestIdWithWhitespace,
        channelId: "channel-1",
        afterSequence: 0,
      }).requestId,
    ).toBe(requestIdWithWhitespace);
    expect(
      ChatStreamSyncEventSchema.safeParse({
        requestId: ` ${"a".repeat(MAX_REQUEST_ID_LENGTH)} `,
        channelId: "channel-1",
        afterSequence: 0,
      }).success,
    ).toBe(false);
    expect(
      ChatStreamSyncEventSchema.safeParse({
        requestId: "   ",
        channelId: "channel-1",
        afterSequence: 0,
      }).success,
    ).toBe(false);
  });
});

describe("stream message response contracts", () => {
  it("enforces continuation cursor semantics for latest, older, and sync-after", () => {
    expect(
      LatestStreamMessagesResponseSchema.safeParse({
        ...createLatestResponse([createMessage(2), createMessage(3)]),
        nextBeforeSequence: 3,
      }).success,
    ).toBe(false);

    expect(
      LatestStreamMessagesResponseSchema.safeParse(
        createLatestResponse(Array.from({ length: 6 }, (_, index) => createMessage(index + 1))),
      ).success,
    ).toBe(false);

    expect(
      OlderStreamMessagesResponseSchema.safeParse({
        streamId: "channel:channel-1",
        beforeSequence: 5,
        messages: [createMessage(3), createMessage(4)],
        nextBeforeSequence: 3,
        hasMoreBefore: true,
      }).success,
    ).toBe(true);

    expect(
      ChatStreamSyncedEventSchema.safeParse({
        requestId: "request-1",
        streamId: "channel:channel-1",
        afterSequence: 3,
        throughSequence: 5,
        messages: [createMessage(4), createMessage(5)],
        nextAfterSequence: 5,
        hasMoreAfter: false,
      }).success,
    ).toBe(true);

    expect(
      ChatStreamSyncedEventSchema.safeParse({
        requestId: "request-1",
        streamId: "channel:channel-1",
        afterSequence: 5,
        throughSequence: 5,
        messages: [],
        nextAfterSequence: 5,
        hasMoreAfter: false,
      }).success,
    ).toBe(true);
  });

  it("rejects pages that skip a cursor boundary or end history early", () => {
    expect(
      LatestStreamMessagesResponseSchema.safeParse({
        ...createLatestResponse([createMessage(2), createMessage(3)]),
        hasMoreBefore: false,
      }).success,
    ).toBe(false);
    expect(
      LatestStreamMessagesResponseSchema.safeParse({
        ...createLatestResponse([createMessage(2), createMessage(3)]),
        hasMoreBefore: true,
      }).success,
    ).toBe(true);

    expect(
      OlderStreamMessagesResponseSchema.safeParse({
        streamId: "channel:channel-1",
        beforeSequence: 6,
        messages: [createMessage(3), createMessage(4)],
        nextBeforeSequence: 3,
        hasMoreBefore: true,
      }).success,
    ).toBe(false);
    expect(
      OlderStreamMessagesResponseSchema.safeParse({
        streamId: "channel:channel-1",
        beforeSequence: 5,
        messages: [createMessage(3), createMessage(4)],
        nextBeforeSequence: 3,
        hasMoreBefore: false,
      }).success,
    ).toBe(false);

    expect(
      ChatStreamSyncedEventSchema.safeParse({
        requestId: "request-1",
        streamId: "channel:channel-1",
        afterSequence: 1,
        throughSequence: 3,
        messages: [createMessage(3)],
        nextAfterSequence: 3,
        hasMoreAfter: false,
      }).success,
    ).toBe(false);
    expect(
      ChatStreamSyncedEventSchema.safeParse({
        requestId: "request-1",
        streamId: "channel:channel-1",
        afterSequence: 1,
        throughSequence: 3,
        messages: [],
        nextAfterSequence: 3,
        hasMoreAfter: false,
      }).success,
    ).toBe(false);
  });

  it("rejects response pages over 100 messages", () => {
    const oneHundredMessages = Array.from({ length: 100 }, (_, index) => createMessage(index + 1));
    const oneHundredOneMessages = [...oneHundredMessages, createMessage(101)];

    expect(
      OlderStreamMessagesResponseSchema.safeParse({
        streamId: "channel:channel-1",
        beforeSequence: 101,
        messages: oneHundredMessages,
        nextBeforeSequence: 1,
        hasMoreBefore: false,
      }).success,
    ).toBe(true);
    expect(
      OlderStreamMessagesResponseSchema.safeParse({
        streamId: "channel:channel-1",
        beforeSequence: 102,
        messages: oneHundredOneMessages,
        nextBeforeSequence: 1,
        hasMoreBefore: false,
      }).success,
    ).toBe(false);

    expect(
      ChatStreamSyncedEventSchema.safeParse({
        requestId: "request-1",
        streamId: "channel:channel-1",
        afterSequence: 0,
        throughSequence: 100,
        messages: oneHundredMessages,
        nextAfterSequence: 100,
        hasMoreAfter: false,
      }).success,
    ).toBe(true);
    expect(
      ChatStreamSyncedEventSchema.safeParse({
        requestId: "request-1",
        streamId: "channel:channel-1",
        afterSequence: 0,
        throughSequence: 101,
        messages: oneHundredOneMessages,
        nextAfterSequence: 101,
        hasMoreAfter: false,
      }).success,
    ).toBe(false);
  });

  it("rejects non-channel stream IDs even when a page is empty", () => {
    expect(
      LatestStreamMessagesResponseSchema.safeParse({
        streamId: "dm:conversation-1",
        throughSequence: 0,
        messages: [],
        nextBeforeSequence: null,
        hasMoreBefore: false,
      }).success,
    ).toBe(false);
    expect(
      OlderStreamMessagesResponseSchema.safeParse({
        streamId: "thread:thread-1",
        beforeSequence: 1,
        messages: [],
        nextBeforeSequence: null,
        hasMoreBefore: false,
      }).success,
    ).toBe(false);
    expect(
      ChatStreamSyncedEventSchema.safeParse({
        requestId: "request-1",
        streamId: "not-a-stream-id",
        afterSequence: 0,
        throughSequence: 0,
        messages: [],
        nextAfterSequence: 0,
        hasMoreAfter: false,
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported SYSTEM message fixtures", () => {
    const systemMessage = {
      ...createMessage(1),
      content: {
        type: "system",
        text: "system fixture",
      },
    };

    expect(
      LatestStreamMessagesResponseSchema.safeParse({
        streamId: "channel:channel-1",
        throughSequence: 1,
        messages: [systemMessage],
        nextBeforeSequence: 1,
        hasMoreBefore: false,
      }).success,
    ).toBe(false);
  });

  it("separates domain rejection, rate limiting, and retryable infrastructure failure", () => {
    expect(
      StreamMessagesHttpErrorResponseSchema.safeParse({
        status: "error",
        code: "stream_unavailable",
        message: "unavailable",
      }).success,
    ).toBe(true);
    expect(
      StreamMessagesHttpErrorResponseSchema.safeParse({
        status: "error",
        code: "rate_limited",
        message: "retry later",
      }).success,
    ).toBe(false);
    expect(
      ChatStreamSyncRejectedEventSchema.safeParse({
        requestId: "request-1",
        code: "rate_limited",
        retryAfterMs: 500,
      }).success,
    ).toBe(true);
    expect(
      ChatStreamSyncFailedEventSchema.safeParse({
        requestId: "request-1",
        code: "stream_messages_unavailable",
        retryable: true,
      }).success,
    ).toBe(true);
  });
});

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
