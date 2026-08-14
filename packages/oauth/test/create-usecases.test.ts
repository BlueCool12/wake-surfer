import { describe, expect, it } from "vitest";

import { createOAuthUsecases } from "../src/application/create-usecases";
import { OAuthConfigError, type OAuthConfig } from "../src/domain/oauth-config";
import type { JwtSignerPort, UserStorePort } from "../src/runtime-deps";

const config: OAuthConfig = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "https://app.example.com/auth/github/callback",
  scopes: ["user:email"],
};

/** 토큰 교환·사용자 조회 응답을 흉내내는 가짜 fetch. */
const fakeFetch = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("access_token")) {
    return new Response(JSON.stringify({ access_token: "gho_x" }), { status: 200 });
  }
  return new Response(JSON.stringify({ id: 999, login: "octo", email: "o@e.com" }), { status: 200 });
}) as typeof globalThis.fetch;

const userStore: UserStorePort = {
  findByProvider: () => undefined,
  create: () => ({ id: "our-1" }),
};

/** 서명 결과에 type·exp를 담아 기본 수명 배선을 확인할 수 있게 한다. */
const signer: JwtSignerPort = {
  sign: (claims) => `${claims.type}:${claims.exp}`,
};

describe("createOAuthUsecases.completeGithubLogin", () => {
  it("auth 미주입 시 호출하면 던진다", async () => {
    const usecases = createOAuthUsecases(config);
    await expect(usecases.completeGithubLogin("code-1")).rejects.toBeInstanceOf(OAuthConfigError);
  });

  it("auth 주입 시 매핑·발급까지 배선되고 기본 수명(30분/14일)이 적용된다", async () => {
    const usecases = createOAuthUsecases(config, {
      fetch: fakeFetch,
      auth: { userStore, jwtSigner: signer, clock: () => 1000 },
    });
    const result = await usecases.completeGithubLogin("code-1");
    expect(result).toEqual({
      status: "ok",
      user: { id: "our-1" },
      tokens: { accessToken: "access:2800", refreshToken: "refresh:1210600" },
    });
  });
});
