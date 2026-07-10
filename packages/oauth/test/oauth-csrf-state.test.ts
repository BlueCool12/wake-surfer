import { describe, expect, it } from "vitest";

import { issueOAuthCsrfState, MIN_OAUTH_CSRF_STATE_BYTES } from "../src/domain/oauth-csrf-state";

describe("issueOAuthCsrfState", () => {
  it("기본으로 32바이트(256비트) 엔트로피를 base64url로 발급한다", () => {
    const state = issueOAuthCsrfState();
    // base64url은 URL-safe 문자(A-Z a-z 0-9 - _)만 사용한다.
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32바이트를 base64url 디코딩하면 다시 32바이트여야 한다.
    expect(Buffer.from(state, "base64url")).toHaveLength(MIN_OAUTH_CSRF_STATE_BYTES);
  });

  it("RNG를 주입하면 결정론적으로 동작한다", () => {
    const fixed = Buffer.alloc(32, 7);
    expect(issueOAuthCsrfState({ randomBytes: () => fixed })).toBe(fixed.toString("base64url"));
  });

  it("요청한 byteLength만큼 엔트로피를 사용한다", () => {
    expect(Buffer.from(issueOAuthCsrfState({ byteLength: 48 }), "base64url")).toHaveLength(48);
  });

  it("32바이트 미만이면 예외를 던진다", () => {
    expect(() => issueOAuthCsrfState({ byteLength: 16 })).toThrow(/at least 32 bytes/);
  });

  it("매 호출마다 서로 다른 state를 발급한다", () => {
    expect(issueOAuthCsrfState()).not.toBe(issueOAuthCsrfState());
  });
});
