import { describe, expect, it } from "vitest";

import {
  ChatStreamSyncFailedEventSchema,
  ChatStreamSyncRejectedEventSchema,
  StreamMessagesHttpErrorResponseSchema,
} from "../src/index";

describe("stream message error contracts", () => {
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
