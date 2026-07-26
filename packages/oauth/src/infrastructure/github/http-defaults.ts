/** GitHub 통신 어댑터들이 공유하는 기본값. */

/** 외부 호출 기본 타임아웃(ms). 초과 시 예외로 전파된다. */
export const DEFAULT_GITHUB_TIMEOUT_MS = 10_000;

/** GitHub API는 User-Agent 헤더가 없으면 403으로 거부한다. */
export const GITHUB_USER_AGENT = "wake-surfer-oauth";
