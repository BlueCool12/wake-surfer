import { describe, expect, it } from "vitest";

import {
  ChatStreamSyncEventSchema,
  DEFAULT_STREAM_MESSAGES_PAGE_LIMIT,
  LatestStreamMessagesHttpRequestSchema,
  MAX_REQUEST_ID_LENGTH,
  OlderStreamMessagesHttpRequestSchema,
  SyncAfterStreamMessagesRequestSchema,
} from "../src/index";

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
