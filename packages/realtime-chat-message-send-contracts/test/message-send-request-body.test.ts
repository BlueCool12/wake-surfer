import { describe, expect, it } from "vitest";

import { parseSendMessageRequest, SendMessageResponseSchema } from "../src/index";

describe("send message request parser", () => {
  it("accepts the idempotency key, target, and text owned by the client", () => {
    expect(
      parseSendMessageRequest({
        idempotencyKey: "idempotency-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        text: " hello ",
      }),
    ).toEqual({
      ok: true,
      value: {
        idempotencyKey: "idempotency-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        text: " hello ",
      },
    });
  });

  it("accepts every supported target variant", () => {
    expect(
      parseSendMessageRequest({
        idempotencyKey: "idempotency-dm",
        target: {
          type: "dm",
          dmConversationId: "dm-1",
        },
        text: "hello",
      }).ok,
    ).toBe(true);
    expect(
      parseSendMessageRequest({
        idempotencyKey: "idempotency-thread",
        target: {
          type: "thread",
          threadId: "thread-1",
        },
        text: "hello",
      }).ok,
    ).toBe(true);
  });

  it("leaves text validation to the send-message feature", () => {
    expect(
      parseSendMessageRequest({
        idempotencyKey: "idempotency-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        text: " ",
      }).ok,
    ).toBe(true);
  });

  it("rejects malformed idempotency keys and server-owned fields", () => {
    const baseRequest = {
      idempotencyKey: "idempotency-1",
      target: {
        type: "channel",
        channelId: "channel-1",
      },
      text: "hello",
    };

    expect(
      parseSendMessageRequest({
        ...baseRequest,
        idempotencyKey: " idempotency-1 ",
      }).ok,
    ).toBe(false);
    expect(
      parseSendMessageRequest({
        ...baseRequest,
        senderActorId: "actor-1",
      }).ok,
    ).toBe(false);
    expect(
      parseSendMessageRequest({
        ...baseRequest,
        sentAtClient: "2026-07-11T00:00:00.000Z",
      }).ok,
    ).toBe(false);
  });
});

describe("send message response schema", () => {
  it("validates an AcceptedTextMessage correlated by idempotencyKey", () => {
    expect(
      SendMessageResponseSchema.parse({
        status: "accepted",
        idempotencyKey: "idempotency-1",
        message: {
          messageId: "message-1",
          streamId: "channel:channel-1",
          sequence: 1,
          senderActorId: "actor-1",
          target: {
            type: "channel",
            channelId: "channel-1",
          },
          text: "hello",
          createdAt: "2026-07-25T06:00:00.000Z",
        },
      }),
    ).toMatchObject({
      status: "accepted",
      idempotencyKey: "idempotency-1",
    });
  });

  it("validates the idempotency conflict rejection", () => {
    expect(
      SendMessageResponseSchema.safeParse({
        status: "rejected",
        idempotencyKey: "idempotency-1",
        reason: "idempotency_conflict",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown rejection reasons and obsolete correlation fields", () => {
    expect(
      SendMessageResponseSchema.safeParse({
        status: "rejected",
        idempotencyKey: "idempotency-1",
        reason: "temporary_failure",
      }).success,
    ).toBe(false);
    expect(
      SendMessageResponseSchema.safeParse({
        status: "rejected",
        idempotencyKey: "idempotency-1",
        commandId: "command-1",
        reason: "invalid_text",
      }).success,
    ).toBe(false);
  });
});
