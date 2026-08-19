/**
 * 라이브러리 reason을 프론트로 넘길 에러 코드로 바꾼다.
 *
 * 콜백은 사용자가 주소창으로 도착하는 지점이라 JSON 대신 로그인 페이지로 돌려보낸다.
 * GitHub 원본 error_description은 사용자에게 노출하지 않고 서버 로그에만 남긴다.
 */
export type LoginErrorCode = "denied" | "expired" | "failed" | "no_email";

export type RejectionReason =
  | "ACCESS_DENIED"
  | "PROVIDER_ERROR"
  | "MISSING_STATE"
  | "STATE_MISMATCH"
  | "MISSING_CODE"
  | "TOKEN_EXCHANGE_FAILED"
  | "USER_FETCH_FAILED"
  | "EMAIL_UNAVAILABLE";

export function toLoginErrorCode(reason: RejectionReason): LoginErrorCode {
  switch (reason) {
    case "ACCESS_DENIED":
      return "denied";
    case "MISSING_STATE":
    case "STATE_MISMATCH":
      return "expired";
    case "EMAIL_UNAVAILABLE":
      return "no_email";
    default:
      return "failed";
  }
}

/** state 불일치는 CSRF 의심이므로 경고로 남긴다. */
export function isSuspicious(reason: RejectionReason): boolean {
  return reason === "STATE_MISMATCH";
}

export function loginFailureRedirect(webOrigin: string, reason: RejectionReason): string {
  const target = new URL("/login", webOrigin);
  target.searchParams.set("error", toLoginErrorCode(reason));
  return target.toString();
}
