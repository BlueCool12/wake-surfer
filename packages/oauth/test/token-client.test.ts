import { describe, expect, it } from "vitest";

import type { OAuthConfig } from "../src/domain/oauth-config";
import { GITHUB_TOKEN_URL } from "../src/infrastructure/github/endpoints";
import { createGithubRequestExecutor } from "../src/infrastructure/github/request-executor";
import { createGithubTokenClient } from "../src/infrastructure/github/token-client";

const baseConfig: OAuthConfig = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "https://app.example.com/auth/github/callback",
  scopes: ["user:email"],
};

/** 요청을 기록하고 준비된 응답을 돌려주는 가짜 fetch. */
function fakeFetch(status: number, body: unknown) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchLike = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetchLike, requests };
}

function tokenClient(fetchLike: typeof globalThis.fetch, config: OAuthConfig = baseConfig) {
  return createGithubTokenClient(config, createGithubRequestExecutor({ fetch: fetchLike }));
}

describe("createGithubTokenClient.exchangeCode", () => {
  it("access_token이 오면 ok로 반환한다", async () => {
    const { fetchLike } = fakeFetch(200, { access_token: "gho_token", token_type: "bearer" });
    const result = await tokenClient(fetchLike).exchangeCode("code-1");
    expect(result).toEqual({ ok: true, accessToken: "gho_token" });
  });

  it("토큰 엔드포인트로 필수 파라미터를 form으로 보낸다", async () => {
    const { fetchLike, requests } = fakeFetch(200, { access_token: "t" });
    await tokenClient(fetchLike).exchangeCode("code-1");

    const request = requests[0]!;
    expect(request.url).toBe(GITHUB_TOKEN_URL);
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("Accept")).toBe("application/json");
    const params = new URLSearchParams(String(request.init?.body));
    expect(params.get("client_id")).toBe("client-123");
    expect(params.get("client_secret")).toBe("secret-456");
    expect(params.get("code")).toBe("code-1");
    expect(params.get("redirect_uri")).toBe(baseConfig.redirectUri);
  });

  it("HTTP 200이어도 body에 error가 있으면 실패로 판정한다 (GitHub 함정)", async () => {
    const { fetchLike } = fakeFetch(200, {
      error: "bad_verification_code",
      error_description: "The code passed is incorrect or expired.",
    });
    const result = await tokenClient(fetchLike).exchangeCode("expired");
    expect(result).toEqual({
      ok: false,
      providerError: {
        error: "bad_verification_code",
        errorDescription: "The code passed is incorrect or expired.",
      },
    });
  });

  it("규격 밖 error 값은 검역되어 providerError 없이 실패한다", async () => {
    const { fetchLike } = fakeFetch(200, { error: "<script>alert(1)</script>" });
    const result = await tokenClient(fetchLike).exchangeCode("c");
    expect(result).toEqual({ ok: false });
  });

  it("비200 응답은 실패로 판정한다", async () => {
    const { fetchLike } = fakeFetch(500, {});
    const result = await tokenClient(fetchLike).exchangeCode("c");
    expect(result).toEqual({ ok: false });
  });

  it("config가 유효하지 않으면 던진다 (fail fast, 요청 전)", async () => {
    const { fetchLike, requests } = fakeFetch(200, { access_token: "t" });
    await expect(
      tokenClient(fetchLike, { ...baseConfig, clientSecret: " " }).exchangeCode("c"),
    ).rejects.toThrow(/clientSecret/);
    expect(requests).toEqual([]);
  });

  it("code가 비어 있으면 던진다", async () => {
    const { fetchLike } = fakeFetch(200, { access_token: "t" });
    await expect(tokenClient(fetchLike).exchangeCode("  ")).rejects.toThrow(/code/);
  });
});
