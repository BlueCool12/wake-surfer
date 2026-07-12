import { describe, expect, it } from "vitest";

import {
  DEFAULT_GITHUB_USER_EMAILS_URL,
  DEFAULT_GITHUB_USER_URL,
  fetchGithubUser,
} from "../src/infrastructure/github/fetch-github-user";

type Route = { status: number; body: unknown };

/** URL별 준비된 응답을 돌려주고 요청을 기록하는 가짜 fetch. */
function fakeFetch(routes: Record<string, Route>) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchLike = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = String(url);
    requests.push({ url: key, init });
    const route = routes[key];
    if (route === undefined) throw new Error(`unexpected request: ${key}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetchLike, requests };
}

describe("fetchGithubUser", () => {
  it("프로필 email이 있으면 그대로 사용하고 emails는 호출하지 않는다", async () => {
    const { fetchLike, requests } = fakeFetch({
      [DEFAULT_GITHUB_USER_URL]: {
        status: 200,
        body: { id: 42, login: "octocat", email: "octo@github.com" },
      },
    });
    const result = await fetchGithubUser({ accessToken: "gho_token", fetch: fetchLike });
    expect(result).toEqual({
      ok: true,
      user: { id: 42, login: "octocat", email: "octo@github.com" },
    });
    expect(requests).toHaveLength(1);
  });

  it("Authorization·User-Agent 헤더를 싣는다 (User-Agent 없으면 GitHub이 403)", async () => {
    const { fetchLike, requests } = fakeFetch({
      [DEFAULT_GITHUB_USER_URL]: {
        status: 200,
        body: { id: 1, login: "a", email: "a@b.com" },
      },
    });
    await fetchGithubUser({ accessToken: "gho_token", fetch: fetchLike });
    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer gho_token");
    expect(headers.get("User-Agent")).toBe("wake-surfer-oauth");
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
  });

  it("프로필 email이 null이면 /user/emails에서 primary·verified를 선택한다", async () => {
    const { fetchLike } = fakeFetch({
      [DEFAULT_GITHUB_USER_URL]: { status: 200, body: { id: 1, login: "a", email: null } },
      [DEFAULT_GITHUB_USER_EMAILS_URL]: {
        status: 200,
        body: [
          { email: "old@b.com", primary: false, verified: true },
          { email: "main@b.com", primary: true, verified: true },
        ],
      },
    });
    const result = await fetchGithubUser({ accessToken: "t", fetch: fetchLike });
    expect(result).toEqual({ ok: true, user: { id: 1, login: "a", email: "main@b.com" } });
  });

  it("primary가 unverified면 EMAIL_UNAVAILABLE로 거부한다", async () => {
    const { fetchLike } = fakeFetch({
      [DEFAULT_GITHUB_USER_URL]: { status: 200, body: { id: 1, login: "a", email: null } },
      [DEFAULT_GITHUB_USER_EMAILS_URL]: {
        status: 200,
        body: [{ email: "main@b.com", primary: true, verified: false }],
      },
    });
    const result = await fetchGithubUser({ accessToken: "t", fetch: fetchLike });
    expect(result).toEqual({ ok: false, reason: "EMAIL_UNAVAILABLE" });
  });

  it("/user가 401이면 USER_FETCH_FAILED로 거부한다", async () => {
    const { fetchLike } = fakeFetch({
      [DEFAULT_GITHUB_USER_URL]: { status: 401, body: { message: "Bad credentials" } },
    });
    const result = await fetchGithubUser({ accessToken: "revoked", fetch: fetchLike });
    expect(result).toEqual({ ok: false, reason: "USER_FETCH_FAILED" });
  });

  it("응답 형태가 어긋나면(id 비숫자) USER_FETCH_FAILED로 거부한다", async () => {
    const { fetchLike } = fakeFetch({
      [DEFAULT_GITHUB_USER_URL]: { status: 200, body: { id: "42", login: "a" } },
    });
    const result = await fetchGithubUser({ accessToken: "t", fetch: fetchLike });
    expect(result).toEqual({ ok: false, reason: "USER_FETCH_FAILED" });
  });

  it("/user/emails가 실패하면 USER_FETCH_FAILED로 거부한다", async () => {
    const { fetchLike } = fakeFetch({
      [DEFAULT_GITHUB_USER_URL]: { status: 200, body: { id: 1, login: "a", email: null } },
      [DEFAULT_GITHUB_USER_EMAILS_URL]: { status: 403, body: { message: "forbidden" } },
    });
    const result = await fetchGithubUser({ accessToken: "t", fetch: fetchLike });
    expect(result).toEqual({ ok: false, reason: "USER_FETCH_FAILED" });
  });
});
