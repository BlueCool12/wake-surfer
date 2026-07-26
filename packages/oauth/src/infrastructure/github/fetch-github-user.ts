import { DEFAULT_GITHUB_TIMEOUT_MS, GITHUB_USER_AGENT } from "./http-defaults";

/** GitHub API 사용자 엔드포인트. */
export const GITHUB_USER_URL = "https://api.github.com/user";
export const GITHUB_USER_EMAILS_URL = "https://api.github.com/user/emails";

export type GithubUser = {
  readonly id: number;
  readonly login: string;
  /** 항상 존재한다. 이메일을 못 얻으면 이 어댑터가 거부한다. */
  readonly email: string;
};

export type FetchGithubUserInput = {
  readonly accessToken: string;
  /** 테스트 주입용. 기본은 내장 fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
};

export type FetchGithubUserResult =
  | { readonly ok: true; readonly user: GithubUser }
  | { readonly ok: false; readonly reason: "USER_FETCH_FAILED" | "EMAIL_UNAVAILABLE" };

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": GITHUB_USER_AGENT,
  };
}

/**
 * access token으로 GitHub 사용자 정보(id·login·email)를 조회한다.
 *
 * 프로필 이메일이 비공개(null)면 /user/emails에서 primary·verified 이메일을 찾고,
 * 끝내 없으면 EMAIL_UNAVAILABLE로 거부한다.
 */
export async function fetchGithubUser(input: FetchGithubUserInput): Promise<FetchGithubUserResult> {
  const doFetch = input.fetch ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;

  const userResponse = await doFetch(GITHUB_USER_URL, {
    headers: githubHeaders(input.accessToken),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!userResponse.ok) {
    return { ok: false, reason: "USER_FETCH_FAILED" };
  }

  const body: unknown = await userResponse.json().catch(() => undefined);
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "USER_FETCH_FAILED" };
  }
  const record = body as Record<string, unknown>;
  const id = record["id"];
  const login = record["login"];
  if (typeof id !== "number" || typeof login !== "string" || login === "") {
    return { ok: false, reason: "USER_FETCH_FAILED" };
  }

  const profileEmail = record["email"];
  if (typeof profileEmail === "string" && profileEmail !== "") {
    return { ok: true, user: { id, login, email: profileEmail } };
  }

  const email = await fetchPrimaryVerifiedEmail(doFetch, input.accessToken, timeoutMs);
  if (email === "USER_FETCH_FAILED") {
    return { ok: false, reason: "USER_FETCH_FAILED" };
  }
  if (email === undefined) {
    return { ok: false, reason: "EMAIL_UNAVAILABLE" };
  }
  return { ok: true, user: { id, login, email } };
}

/** /user/emails에서 primary·verified 이메일을 찾는다. 없으면 undefined. */
async function fetchPrimaryVerifiedEmail(
  doFetch: typeof globalThis.fetch,
  accessToken: string,
  timeoutMs: number,
): Promise<string | undefined | "USER_FETCH_FAILED"> {
  const response = await doFetch(GITHUB_USER_EMAILS_URL, {
    headers: githubHeaders(accessToken),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    return "USER_FETCH_FAILED";
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!Array.isArray(body)) {
    return "USER_FETCH_FAILED";
  }

  for (const entry of body) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      record["primary"] === true &&
      record["verified"] === true &&
      typeof record["email"] === "string" &&
      record["email"] !== ""
    ) {
      return record["email"];
    }
  }
  return undefined;
}
