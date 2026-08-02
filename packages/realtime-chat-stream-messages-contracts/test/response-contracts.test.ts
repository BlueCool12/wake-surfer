import { describe, expect, it } from "vitest";

import {
  ChatStreamSyncedEventSchema,
  LatestStreamMessagesResponseSchema,
  OlderStreamMessagesResponseSchema,
} from "../src/index";
import { createLatestResponse, createMessage } from "./fixtures";

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

  it("rejects the obsolete nested content shape", () => {
    const nestedContentMessage = {
      ...createMessage(1),
      text: undefined,
      content: {
        type: "text",
        text: "nested fixture",
      },
    };

    expect(
      LatestStreamMessagesResponseSchema.safeParse({
        streamId: "channel:channel-1",
        throughSequence: 1,
        messages: [nestedContentMessage],
        nextBeforeSequence: 1,
        hasMoreBefore: false,
      }).success,
    ).toBe(false);
  });
});
