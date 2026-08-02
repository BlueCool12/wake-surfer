import type { ChatMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type { StreamMessage } from "@wake-surfer/realtime-chat-stream-messages";
import { describe, expect, it } from "vitest";

import {
  fitLatestMessagesPage,
  fitNewestContiguousMessages,
  fitOldestContiguousMessages,
  fitSyncAfterMessagesPage,
  StreamMessagesEnvelopeIntegrityError,
} from "../src/features/stream-messages/page-policy.js";

describe("Stream Messages final envelope page policy", () => {
  it("keeps the closest newest contiguous range for latest and older pages", () => {
    const result = fitNewestContiguousMessages({
      messages: createChatMessages(1, 4),
      buildResponse: (messages) => ({ messages }),
      measureFinalEnvelope: ({ messages }) => ({
        utf8ByteLength: messages.length * 20_000,
        isWithinLimit: messages.length <= 2,
      }),
    });

    expect(result.response.messages.map((message) => message.sequence)).toEqual([3, 4]);
    expect(result.envelopeUtf8ByteLength).toBe(40_000);
  });

  it("keeps the closest oldest contiguous range for sync-after pages", () => {
    const result = fitOldestContiguousMessages({
      messages: createChatMessages(11, 14),
      buildResponse: (messages) => ({ messages }),
      measureFinalEnvelope: ({ messages }) => ({
        utf8ByteLength: messages.length * 20_000,
        isWithinLimit: messages.length <= 2,
      }),
    });

    expect(result.response.messages.map((message) => message.sequence)).toEqual([11, 12]);
    expect(result.envelopeUtf8ByteLength).toBe(40_000);
  });

  it("recalculates continuation cursors after the adapter page budget trims messages", () => {
    const latest = fitLatestMessagesPage(
      "channel-page-policy",
      {
        throughSequence: 4,
        messages: createStreamMessages(1, 4),
        nextBeforeSequence: 1,
        hasMoreBefore: false,
      },
      ({ messages }) => ({
        utf8ByteLength: messages.length * 20_000,
        isWithinLimit: messages.length <= 2,
      }),
    );
    const syncAfter = fitSyncAfterMessagesPage(
      "channel-page-policy",
      {
        afterSequence: 10,
        throughSequence: 14,
        messages: createStreamMessages(11, 14),
        nextAfterSequence: 14,
        hasMoreAfter: false,
      },
      ({ messages }) => ({
        utf8ByteLength: messages.length * 20_000,
        isWithinLimit: messages.length <= 2,
      }),
    );

    expect(latest.response).toMatchObject({
      nextBeforeSequence: 3,
      hasMoreBefore: true,
    });
    expect(latest.response.messages.map((message) => message.sequence)).toEqual([3, 4]);
    expect(latest.response.messages[0]).toMatchObject({
      streamId: "channel:channel-page-policy",
      target: {
        type: "channel",
        channelId: "channel-page-policy",
      },
      createdAt: "2026-07-18T00:00:00.000Z",
    });
    expect(syncAfter.response).toMatchObject({
      nextAfterSequence: 12,
      hasMoreAfter: true,
    });
    expect(syncAfter.response.messages.map((message) => message.sequence)).toEqual([11, 12]);
  });

  it("fails without exposing content when one row cannot fit", () => {
    const sensitiveContent = "do-not-log-this-message";

    expect(() =>
      fitNewestContiguousMessages({
        messages: [createMessage(1, sensitiveContent)],
        buildResponse: (messages) => ({ messages }),
        measureFinalEnvelope: () => ({
          utf8ByteLength: 49_153,
          isWithinLimit: false,
        }),
      }),
    ).toThrowError(StreamMessagesEnvelopeIntegrityError);

    try {
      fitNewestContiguousMessages({
        messages: [createMessage(1, sensitiveContent)],
        buildResponse: (messages) => ({ messages }),
        measureFinalEnvelope: () => ({
          utf8ByteLength: 49_153,
          isWithinLimit: false,
        }),
      });
    } catch (error) {
      expect(error).toMatchObject({
        reason: "oversized_row",
        metadata: {
          messageId: "message-1",
          sequence: 1,
          utf8ByteLength: 49_153,
        },
      });
      expect((error as Error).message).not.toContain(sensitiveContent);
    }
  });

  it("rejects invalid adapter measurements", () => {
    expect(() =>
      fitNewestContiguousMessages({
        messages: [],
        buildResponse: (messages) => ({ messages }),
        measureFinalEnvelope: () => ({
          utf8ByteLength: Number.NaN,
          isWithinLimit: true,
        }),
      }),
    ).toThrowError(
      expect.objectContaining({
        reason: "invalid_envelope_measurement",
      }),
    );
  });
});

function createChatMessages(firstSequence: number, lastSequence: number): ChatMessage[] {
  return Array.from({ length: lastSequence - firstSequence + 1 }, (_, index) =>
    createMessage(firstSequence + index, `message ${firstSequence + index}`),
  );
}

function createStreamMessages(firstSequence: number, lastSequence: number): StreamMessage[] {
  return Array.from({ length: lastSequence - firstSequence + 1 }, (_, index) => ({
    messageId: `message-${firstSequence + index}`,
    sequence: firstSequence + index,
    senderActorId: "actor-page-policy",
    text: `message ${firstSequence + index}`,
    createdAt: new Date("2026-07-18T00:00:00.000Z"),
  }));
}

function createMessage(sequence: number, text: string): ChatMessage {
  return {
    messageId: `message-${sequence}`,
    streamId: "channel:channel-page-policy",
    sequence,
    senderActorId: "actor-page-policy",
    target: {
      type: "channel",
      channelId: "channel-page-policy",
    },
    text,
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}
