import { describe, expect, it } from "vitest";

import { AuthApiConfigError, loadAuthApiConfig } from "../src/config/env";

const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    GITHUB_REDIRECT_URI: "http://localhost:3002/auth/github/callback",
    GITHUB_SCOPES: "user:email",
    COOKIE_SECRET: "x".repeat(32),
    JWT_PRIVATE_KEY: PRIVATE_KEY,
    JWT_PUBLIC_KEY: PUBLIC_KEY,
    DATABASE_URL: "postgresql://user:pw@localhost:5433/db",
    WEB_ORIGIN: "http://localhost:5173",
    ...overrides,
  };
}

describe("loadAuthApiConfig", () => {
  it("정상 환경변수를 설정으로 읽는다", () => {
    const config = loadAuthApiConfig(validEnv());

    expect(config.port).toBe(3002);
    expect(config.githubScopes).toEqual(["user:email"]);
    expect(config.webOrigin).toBe("http://localhost:5173");
  });

  it("누락된 키를 한 번에 모아 알려준다", () => {
    const env = validEnv({ GITHUB_CLIENT_ID: undefined, COOKIE_SECRET: undefined });

    expect(() => loadAuthApiConfig(env)).toThrow(AuthApiConfigError);
    expect(() => loadAuthApiConfig(env)).toThrow(/GITHUB_CLIENT_ID.*COOKIE_SECRET/s);
  });

  it("PEM의 \\n 이스케이프를 실제 개행으로 복원한다", () => {
    const config = loadAuthApiConfig(validEnv());

    expect(config.jwtPrivateKey).toContain("\n");
    expect(config.jwtPrivateKey).not.toContain("\\n");
  });

  it("이미 개행이 들어 있는 PEM은 그대로 둔다", () => {
    const config = loadAuthApiConfig(validEnv());

    expect(config.jwtPublicKey).toBe(PUBLIC_KEY);
  });

  it("scope는 쉼표로 나누고 공백을 정리한다", () => {
    const config = loadAuthApiConfig(validEnv({ GITHUB_SCOPES: "user:email, read:user " }));

    expect(config.githubScopes).toEqual(["user:email", "read:user"]);
  });

  it("COOKIE_SECRET이 짧으면 거부한다", () => {
    expect(() => loadAuthApiConfig(validEnv({ COOKIE_SECRET: "short" }))).toThrow(/COOKIE_SECRET/);
  });

  it("redirectUri가 절대 URL이 아니면 거부한다", () => {
    expect(() => loadAuthApiConfig(validEnv({ GITHUB_REDIRECT_URI: "/callback" }))).toThrow(
      /GITHUB_REDIRECT_URI/,
    );
  });

  it("PEM 형식이 아니면 거부한다", () => {
    expect(() => loadAuthApiConfig(validEnv({ JWT_PRIVATE_KEY: "not-a-pem" }))).toThrow(
      /JWT_PRIVATE_KEY/,
    );
  });

  it("https redirectUri면 쿠키 Secure를 켠다", () => {
    const config = loadAuthApiConfig(
      validEnv({ GITHUB_REDIRECT_URI: "https://app.example.com/auth/github/callback" }),
    );

    expect(config.cookieSecure).toBe(true);
  });

  it("http redirectUri면 쿠키 Secure를 끈다 (로컬 개발)", () => {
    expect(loadAuthApiConfig(validEnv()).cookieSecure).toBe(false);
  });
});
