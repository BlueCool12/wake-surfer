import { describe, expect, it } from "vitest";

import { StreamMessagesDataIntegrityError } from "../src/index";
import { parseChannelStreamMetadata, parseStreamMessageRow } from "../src/stream-messages";

describe("Stream Messages storage boundary", () => {
  const expected = {
    streamId: "channel:channel-1",
    channelId: "channel-1",
  };

  it("parses missing and valid raw stream metadata into a discriminated value", () => {
    expect(parseChannelStreamMetadata(undefined, expected)).toEqual({
      status: "missing",
      headSequence: 0,
    });
    expect(
      parseChannelStreamMetadata(
        {
          targetType: "channel",
          targetId: "channel-1",
          headSequence: 3,
        },
        expected,
      ),
    ).toEqual({
      status: "found",
      headSequence: 3,
    });
  });

  it("rejects invalid raw stream metadata", () => {
    expect(() =>
      parseChannelStreamMetadata(
        {
          targetType: "channel",
          targetId: "other-channel",
          headSequence: 3,
        },
        expected,
      ),
    ).toThrow(StreamMessagesDataIntegrityError);
  });

  it("returns the provider message model without exposing the storage stream ID", () => {
    const message = parseStreamMessageRow(
      {
        messageId: "message-1",
        streamId: "channel:channel-1",
        sequence: 1,
        senderActorId: "actor-1",
        targetType: "channel",
        targetId: "channel-1",
        content: {
          schemaVersion: 1,
          kind: "text",
          text: "hello",
        },
        createdAt: new Date("2026-07-21T00:00:00.000Z"),
      },
      expected,
    );

    expect(message).toEqual({
      messageId: "message-1",
      sequence: 1,
      senderActorId: "actor-1",
      content: {
        type: "text",
        text: "hello",
      },
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
    });
    expect(message).not.toHaveProperty("streamId");
  });

  it("rejects malformed persisted JSONB content", () => {
    expect(() =>
      parseStreamMessageRow(
        {
          messageId: "message-1",
          streamId: "channel:channel-1",
          sequence: 1,
          senderActorId: "actor-1",
          targetType: "channel",
          targetId: "channel-1",
          content: {
            schemaVersion: 2,
            kind: "text",
            text: "hello",
          },
          createdAt: new Date("2026-07-21T00:00:00.000Z"),
        },
        expected,
      ),
    ).toThrow(StreamMessagesDataIntegrityError);
  });
});
