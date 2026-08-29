/** auth-api가 `?error=` 로 넘기는 코드. 사용자에게 보일 문구로만 바꾼다. */
const FALLBACK = "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";

const MESSAGES: Record<string, string> = {
  denied: "GitHub 로그인이 취소되었습니다.",
  expired: "로그인 시간이 만료되었습니다. 다시 시도해 주세요.",
  no_email: "GitHub 계정에 인증된 이메일이 없습니다. 이메일을 등록한 뒤 다시 시도해 주세요.",
  failed: FALLBACK,
};

export function loginErrorMessage(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  return MESSAGES[code] ?? FALLBACK;
}
