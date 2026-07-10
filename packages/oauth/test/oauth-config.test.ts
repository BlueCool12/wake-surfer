import { describe, expect, it } from "vitest";

import {
  assertValidOAuthConfig,
  OAuthConfigError,
  type OAuthConfig,
} from "../src/domain/oauth-config";

const validConfig: OAuthConfig = {
  clientId: "client-123",
  redirectUri: "https://app.example.com/auth/github/callback",
  scopes: ["user:email"],
};

describe("assertValidOAuthConfig", () => {
  it("유효한 설정은 통과한다", () => {
    expect(() => assertValidOAuthConfig(validConfig)).not.toThrow();
  });

  it("clientId가 비어 있으면 OAuthConfigError를 던진다", () => {
    expect(() => assertValidOAuthConfig({ ...validConfig, clientId: "  " })).toThrow(
      OAuthConfigError,
    );
  });

  it("scopes가 비어 있으면 예외를 던진다", () => {
    expect(() => assertValidOAuthConfig({ ...validConfig, scopes: [] })).toThrow(
      /at least one scope/,
    );
  });

  it("scopes에 빈 값이 섞이면 예외를 던진다", () => {
    expect(() => assertValidOAuthConfig({ ...validConfig, scopes: ["user:email", " "] })).toThrow(
      /empty values/,
    );
  });

  it("redirectUri가 비어 있으면 예외를 던진다", () => {
    expect(() => assertValidOAuthConfig({ ...validConfig, redirectUri: "  " })).toThrow(
      OAuthConfigError,
    );
  });
});
