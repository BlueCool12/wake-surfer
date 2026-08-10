import { describe, expect, it } from "vitest";

import {
  createPersistedTextMessageContent,
  parsePersistedTextMessageContent,
} from "../src/persisted-message-content";

describe("persisted text message content", () => {
  it("encodes and parses the canonical JSONB value", () => {
    const content = createPersistedTextMessageContent("안녕하세요");

    expect(content).toEqual({
      schemaVersion: 1,
      kind: "text",
      text: "안녕하세요",
    });
    expect(parsePersistedTextMessageContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
  });

  it.each([
    { schemaVersion: 2, kind: "text", text: "hello" },
    { schemaVersion: 1, kind: "text", text: " hello " },
    { schemaVersion: 1, kind: "text", text: "a".repeat(8_193) },
    { schemaVersion: 1, kind: "text", text: "hello", unexpected: true },
  ])("rejects a value outside the persisted schema", (content) => {
    expect(() => parsePersistedTextMessageContent(content)).toThrow(
      "canonical schema와 일치하지 않습니다",
    );
  });
});
