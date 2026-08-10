import { GITHUB_USER_AGENT, GITHUB_USER_EMAILS_URL, GITHUB_USER_URL } from "./endpoints";
import type { GithubRequestExecutor } from "./request-executor";

export type GithubUser = {
  readonly id: number;
  readonly login: string;
  /** 항상 존재한다. 이메일을 못 얻으면 이 클라이언트가 거부한다. */
  readonly email: string;
};

export type FetchGithubUserResult =
  | { readonly ok: true; readonly user: GithubUser }
  | { readonly ok: false; readonly reason: "USER_FETCH_FAILED" | "EMAIL_UNAVAILABLE" };

export type GithubUserClient = {
  /** access token으로 사용자 정보(id·login·email)를 조회한다. */
  fetchUser: (accessToken: string) => Promise<FetchGithubUserResult>;
};

/** 이메일 조회 결과. 값과 실패 원인을 명시적 상태로 구분한다. */
type EmailLookupResult =
  | { readonly status: "found"; readonly email: string }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" };

function userFetchFailed(): FetchGithubUserResult {
  return { ok: false, reason: "USER_FETCH_FAILED" };
}

function emailUnavailable(): FetchGithubUserResult {
  return { ok: false, reason: "EMAIL_UNAVAILABLE" };
}

function userFetchSucceeded(user: GithubUser): FetchGithubUserResult {
  return { ok: true, user };
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": GITHUB_USER_AGENT,
  };
}

/**
 * 프로필 이메일이 비공개(null)면 /user/emails에서 primary·verified 이메일을 찾고,
 * 끝내 없으면 EMAIL_UNAVAILABLE로 거부한다.
 */
export function createGithubUserClient(executor: GithubRequestExecutor): GithubUserClient {
  return {
    async fetchUser(accessToken) {
      const response = await executor.executeJson({
        url: GITHUB_USER_URL,
        headers: githubHeaders(accessToken),
      });
      if (!response.ok || typeof response.body !== "object" || response.body === null) {
        return userFetchFailed();
      }

      const record = response.body as Record<string, unknown>;
      const id = record["id"];
      const login = record["login"];
      if (typeof id !== "number" || typeof login !== "string" || login === "") {
        return userFetchFailed();
      }

      const profileEmail = record["email"];
      if (typeof profileEmail === "string" && profileEmail !== "") {
        return userFetchSucceeded({ id, login, email: profileEmail });
      }

      const lookup = await lookupPrimaryVerifiedEmail(executor, accessToken);
      if (lookup.status === "failed") {
        return userFetchFailed();
      }
      if (lookup.status === "unavailable") {
        return emailUnavailable();
      }
      return userFetchSucceeded({ id, login, email: lookup.email });
    },
  };
}

async function lookupPrimaryVerifiedEmail(
  executor: GithubRequestExecutor,
  accessToken: string,
): Promise<EmailLookupResult> {
  const response = await executor.executeJson({
    url: GITHUB_USER_EMAILS_URL,
    headers: githubHeaders(accessToken),
  });
  if (!response.ok || !Array.isArray(response.body)) {
    return { status: "failed" };
  }

  for (const entry of response.body) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      record["primary"] === true &&
      record["verified"] === true &&
      typeof record["email"] === "string" &&
      record["email"] !== ""
    ) {
      return { status: "found", email: record["email"] };
    }
  }
  return { status: "unavailable" };
}
