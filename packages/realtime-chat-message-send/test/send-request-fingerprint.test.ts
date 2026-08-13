import { describe, expect, it } from "vitest";

import {
  createSendRequestFingerprint,
  matchesSendRequestFingerprint,
  parseSendRequestFingerprint,
} from "../src/send-request-fingerprint";

describe("send request fingerprint", () => {
  it("is stable for the same canonical request", () => {
    const first = createSendRequestFingerprint(
      { type: "channel", channelId: "channel-1" },
      "hello",
    );
    const second = createSendRequestFingerprint(
      { type: "channel", channelId: "channel-1" },
      "hello",
    );

    expect(first).toMatchObject({
      canonicalizationVersion: 1,
      algorithm: "sha256",
      keyId: null,
      value: expect.objectContaining({ byteLength: 32 }),
    });
    expect(matchesSendRequestFingerprint(first, second)).toBe(true);
  });

  it("binds the fingerprint to the target and content", () => {
    const original = createSendRequestFingerprint(
      { type: "channel", channelId: "channel-1" },
      "hello",
    );
    const otherTarget = createSendRequestFingerprint(
      { type: "channel", channelId: "channel-2" },
      "hello",
    );
    const otherContent = createSendRequestFingerprint(
      { type: "channel", channelId: "channel-1" },
      "different",
    );

    expect(matchesSendRequestFingerprint(original, otherTarget)).toBe(false);
    expect(matchesSendRequestFingerprint(original, otherContent)).toBe(false);
  });

  it("rejects unsupported persisted fingerprint schemes", () => {
    expect(() =>
      parseSendRequestFingerprint({
        canonicalizationVersion: 2,
        algorithm: "sha256",
        keyId: null,
        value: new Uint8Array([1]),
      }),
    ).toThrow("fingerprint scheme이 지원되지 않습니다");
  });
});
