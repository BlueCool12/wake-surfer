import { describe, expect, it } from "vitest";

import { parseDeleteMessageRequest, parseEditMessageRequest } from "../src/index";

describe("edit message request parser", () => {
  it("accepts a message id and replacement text", () => {
    expect(
      parseEditMessageRequest({
        messageId: "message-1",
        text: "수정할 내용",
      }),
    ).toEqual({
      ok: true,
      value: {
        messageId: "message-1",
        text: "수정할 내용",
      },
    });
  });

  it("leaves text validation to the edit-message feature", () => {
    expect(
      parseEditMessageRequest({
        messageId: "message-1",
        text: " ",
      }),
    ).toEqual({
      ok: true,
      value: {
        messageId: "message-1",
        text: " ",
      },
    });
  });

  it.each([
    {},
    { messageId: "", text: "수정할 내용" },
    { messageId: " ", text: "수정할 내용" },
    { messageId: 1, text: "수정할 내용" },
    { messageId: "message-1" },
    { messageId: "message-1", text: 1 },
  ])("rejects an invalid edit request: %j", (request) => {
    expect(parseEditMessageRequest(request)).toEqual({
      ok: false,
      message: "메시지 수정 요청 본문이 올바르지 않습니다.",
    });
  });

  it("rejects fields outside the edit command", () => {
    expect(
      parseEditMessageRequest({
        messageId: "message-1",
        text: "수정할 내용",
        version: 1,
      }).ok,
    ).toBe(false);
  });
});

describe("delete message request parser", () => {
  it("accepts a message id", () => {
    expect(
      parseDeleteMessageRequest({
        messageId: "message-1",
      }),
    ).toEqual({
      ok: true,
      value: {
        messageId: "message-1",
      },
    });
  });

  it.each([{}, { messageId: "" }, { messageId: " " }, { messageId: 1 }])(
    "rejects an invalid delete request: %j",
    (request) => {
      expect(parseDeleteMessageRequest(request)).toEqual({
        ok: false,
        message: "메시지 삭제 요청 본문이 올바르지 않습니다.",
      });
    },
  );

  it("rejects fields outside the delete command", () => {
    expect(
      parseDeleteMessageRequest({
        messageId: "message-1",
        text: "삭제 요청에는 본문이 없다",
      }).ok,
    ).toBe(false);
  });
});
