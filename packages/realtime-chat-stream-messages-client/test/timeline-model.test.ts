import { describe, expect, it } from "vitest";

import { StreamMessageProtocolError, StreamMessagesTimelineModel } from "../src/index.js";

describe("sequence-aware Stream Messages timeline", () => {
  it("keeps live messages that arrive before latest and drains later gaps in order", () => {
    const model = new StreamMessagesTimelineModel("channel-model");
    model.applyLive(createMessage(6));
    model.applyLatest({
      streamId: model.streamId,
      throughSequence: 5,
      messages: createMessages(1, 5),
      nextBeforeSequence: 1,
      hasMoreBefore: false,
    });

    expect(model.messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(model.deliverySyncCursor).toBe(6);

    model.applyLive(createMessage(8));
    expect(model.hasBufferedGap).toBe(true);
    expect(model.messages.map((message) => message.sequence)).not.toContain(8);

    model.applyLive(createMessage(7));
    expect(model.messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(model.deliverySyncCursor).toBe(8);
    expect(model.hasBufferedGap).toBe(false);
  });

  it("does not move delivery cursor when older history is merged", () => {
    const model = new StreamMessagesTimelineModel("channel-model");
    model.applyLatest({
      streamId: model.streamId,
      throughSequence: 5,
      messages: createMessages(4, 5),
      nextBeforeSequence: 4,
      hasMoreBefore: true,
    });

    model.applyOlder({
      streamId: model.streamId,
      beforeSequence: 4,
      messages: createMessages(1, 3),
      nextBeforeSequence: 1,
      hasMoreBefore: false,
    });

    expect(model.messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(model.deliverySyncCursor).toBe(5);
    expect(model.historyBeforeCursor).toBe(1);
  });

  it("drops delayed pre-checkpoint events outside the loaded window", () => {
    const model = new StreamMessagesTimelineModel("channel-model");
    model.applyLatest({
      streamId: model.streamId,
      throughSequence: 5,
      messages: createMessages(4, 5),
      nextBeforeSequence: 4,
      hasMoreBefore: true,
    });

    model.applyLive(createMessage(2));

    expect(model.messages.map((message) => message.sequence)).toEqual([4, 5]);
    expect(model.deliverySyncCursor).toBe(5);
  });

  it("rejects conflicting message identity and non-channel targets", () => {
    const model = new StreamMessagesTimelineModel("channel-model");
    model.applyLatest({
      streamId: model.streamId,
      throughSequence: 1,
      messages: [createMessage(1)],
      nextBeforeSequence: 1,
      hasMoreBefore: false,
    });

    expect(() => model.applyLive({ ...createMessage(2), sequence: 1 })).toThrowError(
      expect.objectContaining({ reason: "message_identity_conflict" }),
    );
    expect(() =>
      model.applyLive({
        ...createMessage(2),
        streamId: "thread:thread-1",
        target: { type: "thread", threadId: "thread-1" },
      }),
    ).toThrowError(StreamMessageProtocolError);
  });
});

function createMessages(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => createMessage(first + index));
}

function createMessage(sequence: number) {
  return {
    messageId: `message-${sequence}`,
    streamId: "channel:channel-model",
    sequence,
    senderActorId: "actor-model",
    target: { type: "channel" as const, channelId: "channel-model" },
    content: { type: "text" as const, text: `message ${sequence}` },
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}
