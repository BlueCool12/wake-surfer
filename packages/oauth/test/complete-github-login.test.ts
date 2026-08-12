import { describe, expect, it } from "vitest";

import { completeGithubLogin } from "../src/application/complete-github-login.usecase";
import type { GithubOAuthClient } from "../src/infrastructure/github/client";
import type { GithubUser } from "../src/infrastructure/github/user-client";
import type { JwtSignerPort, UserStorePort } from "../src/runtime-deps";

const githubUser: GithubUser = { id: 12345, login: "octocat", email: "octo@example.com" };

function fakeClient(over: Partial<GithubOAuthClient> = {}): GithubOAuthClient {
  return {
    exchangeCode: async () => ({ ok: true, accessToken: "tok" }),
    fetchUser: async () => ({ ok: true, user: githubUser }),
    ...over,
  };
}

const userStore: UserStorePort = {
  findByProvider: () => undefined,
  create: () => ({ id: "our-1" }),
};

const signer: JwtSignerPort = {
  sign: (claims) => `${claims.type}:${claims.sub}`,
};

const deps = {
  userStore,
  signer,
  accessTtlSec: 1800,
  refreshTtlSec: 1_209_600,
  now: () => 1_000_000,
  code: "code-1",
};

describe("completeGithubLogin", () => {
  it("성공 시 매핑된 회원과 발급된 토큰을 돌려준다", async () => {
    const result = await completeGithubLogin({ ...deps, client: fakeClient() });
    expect(result).toEqual({
      status: "ok",
      user: { id: "our-1" },
      tokens: { accessToken: "access:our-1", refreshToken: "refresh:our-1" },
    });
  });

  it("토큰 교환 실패를 TOKEN_EXCHANGE_FAILED로 전파한다 (providerError 보존)", async () => {
    const client = fakeClient({
      exchangeCode: async () => ({ ok: false, providerError: { error: "bad_verification_code" } }),
    });
    const result = await completeGithubLogin({ ...deps, client });
    expect(result).toEqual({
      status: "rejected",
      reason: "TOKEN_EXCHANGE_FAILED",
      providerError: { error: "bad_verification_code" },
    });
  });

  it("사용자 조회 실패를 USER_FETCH_FAILED로 전파한다", async () => {
    const client = fakeClient({ fetchUser: async () => ({ ok: false, reason: "USER_FETCH_FAILED" }) });
    const result = await completeGithubLogin({ ...deps, client });
    expect(result).toEqual({ status: "rejected", reason: "USER_FETCH_FAILED" });
  });

  it("이메일을 못 얻으면 EMAIL_UNAVAILABLE로 전파한다", async () => {
    const client = fakeClient({ fetchUser: async () => ({ ok: false, reason: "EMAIL_UNAVAILABLE" }) });
    const result = await completeGithubLogin({ ...deps, client });
    expect(result).toEqual({ status: "rejected", reason: "EMAIL_UNAVAILABLE" });
  });
});
