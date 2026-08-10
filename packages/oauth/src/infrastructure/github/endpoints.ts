/** GitHub 통신 엔드포인트와 기본값. */

export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_USER_URL = "https://api.github.com/user";
export const GITHUB_USER_EMAILS_URL = "https://api.github.com/user/emails";

/** 외부 호출 기본 타임아웃(ms). 초과 시 예외로 전파된다. */
export const DEFAULT_GITHUB_TIMEOUT_MS = 10_000;

/** GitHub API는 User-Agent 헤더가 없으면 403으로 거부한다. */
export const GITHUB_USER_AGENT = "wake-surfer-oauth";
