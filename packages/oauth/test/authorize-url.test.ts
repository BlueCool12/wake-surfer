import { describe, expect, it } from "vitest";

import type { OAuthConfig } from "../src/domain/oauth-config";
import { createAuthorizeUrl, DEFAULT_GITHUB_AUTHORIZE_URL } from "../src/infrastructure/github/authorize-url";

const baseConfig: OAuthConfig = {
  clientId: "client-123",
  redirectUri: "https://app.example.com/auth/github/callback",
  scopes: ["user:email"],
};

describe("createAuthorizeUrl", () => {
  it("기본값은 github.com authorize 엔드포인트를 가리킨다", () => {
    const url = new URL(createAuthorizeUrl(baseConfig, "state-abc"));
    expect(`${url.origin}${url.pathname}`).toBe(DEFAULT_GITHUB_AUTHORIZE_URL);
  });

  it("client_id/redirect_uri/scope/state를 쿼리로 싣는다", () => {
    const url = new URL(createAuthorizeUrl(baseConfig, "state-abc"));
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(baseConfig.redirectUri);
    expect(url.searchParams.get("scope")).toBe("user:email");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });

  it("scope가 여러 개면 공백으로 이어 붙인다", () => {
    const url = new URL(
      createAuthorizeUrl({ ...baseConfig, scopes: ["user:email", "read:user"] }, "s"),
    );
    expect(url.searchParams.get("scope")).toBe("user:email read:user");
  });

  it("authorizeBaseUrl로 엔드포인트를 오버라이드할 수 있다 (GitHub Enterprise 등)", () => {
    const enterprise = "https://github.acme.com/login/oauth/authorize";
    const url = new URL(createAuthorizeUrl({ ...baseConfig, authorizeBaseUrl: enterprise }, "s"));
    expect(`${url.origin}${url.pathname}`).toBe(enterprise);
  });

  it("config가 유효하지 않으면 던진다", () => {
    expect(() => createAuthorizeUrl({ ...baseConfig, redirectUri: "  " }, "s")).toThrow(
      /redirectUri/,
    );
  });

  it("state가 비어 있으면 던진다", () => {
    expect(() => createAuthorizeUrl(baseConfig, "  ")).toThrow(/state/);
  });
});
