import { describe, expect, it } from "vitest";

import { createOAuthUsecases } from "../src/application/create-usecases";
import { fetchGithubUserByCode } from "../src/application/fetch-github-user-by-code.usecase";
import type { OAuthConfig } from "../src/domain/oauth-config";
import { createGithubOAuthClient } from "../src/infrastructure/github/client";
import {
  GITHUB_TOKEN_URL,
  GITHUB_USER_EMAILS_URL,
  GITHUB_USER_URL,
} from "../src/infrastructure/github/endpoints";

const config: OAuthConfig = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "https://app.example.com/auth/github/callback",
  scopes: ["user:email"],
};

type Route = { status: number; body: unknown };

/** URL별 준비된 응답을 돌려주고 호출 순서를 기록하는 가짜 fetch. */
function fakeFetch(routes: Record<string, Route>) {
  const requests: string[] = [];
  const fetchLike = (async (url: string | URL | Request) => {
    const key = String(url);
    requests.push(key);
    const route = routes[key];
    if (route === undefined) throw new Error(`unexpected request: ${key}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetchLike, requests };
}

describe("fetchGithubUserByCode", () => {
  it("해피패스: code → 토큰 교환 → 사용자 조회 → user 반환", async () => {
    const { fetchLike, requests } = fakeFetch({
      [GITHUB_TOKEN_URL]: { status: 200, body: { access_token: "gho_token" } },
      [GITHUB_USER_URL]: {
        status: 200,
        body: { id: 42, login: "octocat", email: "octo@github.com" },
      },
    });
    const client = createGithubOAuthClient(config, { fetch: fetchLike });
    const result = await fetchGithubUserByCode({ client, code: "code-1" });
    expect(result).toEqual({
      status: "ok",
      user: { id: 42, login: "octocat", email: "octo@github.com" },
    });
    expect(requests).toEqual([GITHUB_TOKEN_URL, GITHUB_USER_URL]);
  });

  it("결과에 access token이 포함되지 않는다 (비노출 원칙)", async () => {
    const { fetchLike } = fakeFetch({
      [GITHUB_TOKEN_URL]: { status: 200, body: { access_token: "gho_secret_token" } },
      [GITHUB_USER_URL]: { status: 200, body: { id: 1, login: "a", email: "a@b.com" } },
    });
    const client = createGithubOAuthClient(config, { fetch: fetchLike });
    const result = await fetchGithubUserByCode({ client, code: "c" });
    expect(JSON.stringify(result)).not.toContain("gho_secret_token");
  });

  it("토큰 교환 실패는 TOKEN_EXCHANGE_FAILED로, 원본을 보존해 반환한다", async () => {
    const { fetchLike, requests } = fakeFetch({
      [GITHUB_TOKEN_URL]: { status: 200, body: { error: "bad_verification_code" } },
    });
    const client = createGithubOAuthClient(config, { fetch: fetchLike });
    const result = await fetchGithubUserByCode({ client, code: "expired" });
    expect(result).toEqual({
      status: "rejected",
      reason: "TOKEN_EXCHANGE_FAILED",
      providerError: { error: "bad_verification_code" },
    });
    expect(requests).toEqual([GITHUB_TOKEN_URL]); // 사용자 조회로 안 넘어감
  });

  it("사용자 조회 실패는 USER_FETCH_FAILED로 반환한다", async () => {
    const { fetchLike } = fakeFetch({
      [GITHUB_TOKEN_URL]: { status: 200, body: { access_token: "t" } },
      [GITHUB_USER_URL]: { status: 401, body: { message: "Bad credentials" } },
    });
    const client = createGithubOAuthClient(config, { fetch: fetchLike });
    const result = await fetchGithubUserByCode({ client, code: "c" });
    expect(result).toEqual({ status: "rejected", reason: "USER_FETCH_FAILED" });
  });

  it("검증된 이메일이 없으면 EMAIL_UNAVAILABLE로 반환한다", async () => {
    const { fetchLike } = fakeFetch({
      [GITHUB_TOKEN_URL]: { status: 200, body: { access_token: "t" } },
      [GITHUB_USER_URL]: { status: 200, body: { id: 1, login: "a", email: null } },
      [GITHUB_USER_EMAILS_URL]: { status: 200, body: [] },
    });
    const client = createGithubOAuthClient(config, { fetch: fetchLike });
    const result = await fetchGithubUserByCode({ client, code: "c" });
    expect(result).toEqual({ status: "rejected", reason: "EMAIL_UNAVAILABLE" });
  });
});

describe("createOAuthUsecases.fetchGithubUserByCode", () => {
  it("팩토리에 주입한 fetch로 동작한다 (부팅 시 조립, 호출 시 code만 전달)", async () => {
    const { fetchLike } = fakeFetch({
      [GITHUB_TOKEN_URL]: { status: 200, body: { access_token: "t" } },
      [GITHUB_USER_URL]: { status: 200, body: { id: 7, login: "u", email: "u@b.com" } },
    });
    const usecases = createOAuthUsecases(config, { fetch: fetchLike });
    const result = await usecases.fetchGithubUserByCode("code-1");
    expect(result).toEqual({ status: "ok", user: { id: 7, login: "u", email: "u@b.com" } });
  });
});
