import { describe, expect, it } from "vitest";
import { parseSendMessageRequestBody } from "../src/index";

describe("send message request body parser", () => {
  it("accepts a channel target request body", () => {
    expect(
      parseSendMessageRequestBody({
        commandId: "cmd-1",
        clientMessageId: "client-message-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        commandId: "cmd-1",
        clientMessageId: "client-message-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
      },
    });
  });

  it("accepts DM and thread target request bodies", () => {
    expect(
      parseSendMessageRequestBody({
        clientMessageId: "client-message-1",
        target: {
          type: "dm",
          dmConversationId: "dm-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
      }).ok,
    ).toBe(true);

    expect(
      parseSendMessageRequestBody({
        clientMessageId: "client-message-2",
        target: {
          type: "thread",
          threadId: "thread-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
      }).ok,
    ).toBe(true);
  });

  it("trims client-owned string values", () => {
    expect(
      parseSendMessageRequestBody({
        clientMessageId: " client-message-1 ",
        target: {
          type: "channel",
          channelId: " channel-1 ",
        },
        content: {
          type: "text",
          text: " hello ",
        },
        sentAtClient: " 2026-07-11T00:00:00.000Z ",
      }),
    ).toEqual({
      ok: true,
      value: {
        clientMessageId: "client-message-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
        sentAtClient: "2026-07-11T00:00:00.000Z",
      },
    });
  });

  it("rejects server-owned fields from the client request body", () => {
    expect(
      parseSendMessageRequestBody({
        actorId: "actor-1",
        streamId: "stream-1",
        sequence: 1,
        recipientUserIds: ["actor-2"],
        clientMessageId: "client-message-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
      }),
    ).toEqual({
      ok: false,
      message: "메시지 전송 요청 본문이 올바르지 않습니다.",
    });
  });

  it("rejects blank content", () => {
    expect(
      parseSendMessageRequestBody({
        clientMessageId: "client-message-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: " ",
        },
      }),
    ).toEqual({
      ok: false,
      message: "메시지 전송 요청 본문이 올바르지 않습니다.",
    });
  });

  it("accepts an ISO datetime with an explicit timezone offset", () => {
    expect(
      parseSendMessageRequestBody({
        clientMessageId: "client-message-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
        sentAtClient: "2026-07-11T09:00:00+09:00",
      }).ok,
    ).toBe(true);
  });

  it("rejects sentAtClient when it is not an ISO datetime", () => {
    expect(
      parseSendMessageRequestBody({
        clientMessageId: "client-message-1",
        target: {
          type: "channel",
          channelId: "channel-1",
        },
        content: {
          type: "text",
          text: "hello",
        },
        sentAtClient: "yesterday",
      }),
    ).toEqual({
      ok: false,
      message: "메시지 전송 요청 본문이 올바르지 않습니다.",
    });
  });
});
