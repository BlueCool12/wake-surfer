import { describe, expect, it } from "vitest";

import {
  isSuspicious,
  loginFailureRedirect,
  toLoginErrorCode,
  type RejectionReason,
} from "../src/auth/login-result.mapper";

describe("toLoginErrorCode", () => {
  it.each([
    ["ACCESS_DENIED", "denied"],
    ["MISSING_STATE", "expired"],
    ["STATE_MISMATCH", "expired"],
    ["EMAIL_UNAVAILABLE", "no_email"],
    ["MISSING_CODE", "failed"],
    ["PROVIDER_ERROR", "failed"],
    ["TOKEN_EXCHANGE_FAILED", "failed"],
    ["USER_FETCH_FAILED", "failed"],
  ] as const)("%s → %s", (reason, expected) => {
    expect(toLoginErrorCode(reason)).toBe(expected);
  });
});

describe("isSuspicious", () => {
  it("state 불일치만 의심으로 본다", () => {
    expect(isSuspicious("STATE_MISMATCH")).toBe(true);
    expect(isSuspicious("ACCESS_DENIED")).toBe(false);
    expect(isSuspicious("TOKEN_EXCHANGE_FAILED")).toBe(false);
  });
});

describe("loginFailureRedirect", () => {
  it("프론트 로그인 페이지로 에러 코드를 붙여 보낸다", () => {
    expect(loginFailureRedirect("http://localhost:5173", "ACCESS_DENIED")).toBe(
      "http://localhost:5173/login?error=denied",
    );
  });

  it("GitHub 원본 reason을 쿼리에 노출하지 않는다", () => {
    const reasons: RejectionReason[] = ["PROVIDER_ERROR", "TOKEN_EXCHANGE_FAILED"];

    for (const reason of reasons) {
      expect(loginFailureRedirect("http://localhost:5173", reason)).not.toContain(reason);
    }
  });
});
