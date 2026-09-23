import "reflect-metadata";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PrismaService } from "../../dist/prisma/prisma.service";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOAuthUsecases, type OAuthUsecases } from "@wake-surfer/oauth";
import { AuthController } from "../../dist/auth/auth.controller";
import { SessionController } from "../../dist/auth/session.controller";
import { AUTH_CONFIG, OAUTH_USECASES } from "../../dist/auth/auth.tokens";
import { createPrismaSessionStore } from "../../dist/adapters/prisma-session-store";
import { createPrismaUserStore } from "../../dist/adapters/prisma-user-store";
import { createRs256JwtSigner } from "../../dist/adapters/rs256-jwt-signer";
import { createRs256RefreshVerifier } from "../../dist/adapters/rs256-refresh-verifier";
import type { AuthApiConfig } from "../../dist/config/env";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== "/auth_test" ||
  new URL(databaseUrl).searchParams.get("schema") !== "auth" ||
  new URL(databaseUrl).hostname !== "127.0.0.1"
)
  throw new Error("Use test:integration with an isolated auth_test database");
const prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const origin = "http://localhost:5173";
const config: AuthApiConfig = {
  port: 0,
  githubClientId: "test",
  githubClientSecret: "test",
  githubRedirectUri: "http://localhost/auth/github/callback",
  githubScopes: ["user:email"],
  cookieSecret: "test-state-secret-at-least-32-characters",
  jwtPrivateKey: keys.privateKey,
  jwtPublicKey: keys.publicKey,
  databaseUrl,
  webOrigin: origin,
  cookieSecure: false,
};
let app: NestExpressApplication;
let base: string;
let oauth: OAuthUsecases;
const store = createPrismaSessionStore(prisma);
const signer = createRs256JwtSigner(keys.privateKey);
function cookie(r: Response, name: string): string {
  const value = r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name}`);
  return value.split(";")[0]!;
}
const refreshCookie = (r: Response) => cookie(r, "refresh_token");
function post(path: string, value = "", requestOrigin: string | undefined = origin) {
  return fetch(base + path, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...(requestOrigin === undefined ? {} : { Origin: requestOrigin }),
      ...(value ? { Cookie: value } : {}),
    },
  });
}
async function login() {
  const start = await fetch(base + "/auth/github/login", { redirect: "manual" });
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const stateCookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const response = await fetch(
    base + `/auth/github/callback?code=test&state=${encodeURIComponent(state)}`,
    { redirect: "manual", headers: { Cookie: stateCookie } },
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${origin}/rooms`);
  return response;
}
async function decode(r: Response) {
  const { decodeJwt } = await import("jose");
  return decodeJwt(decodeURIComponent(refreshCookie(r).slice("refresh_token=".length)));
}

beforeAll(async () => {
  await prisma.$connect();
  oauth = createOAuthUsecases(
    {
      clientId: "test",
      clientSecret: "test",
      redirectUri: config.githubRedirectUri,
      scopes: ["user:email"],
    },
    {
      fetch: async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("access_token")
              ? { access_token: "test-github-token" }
              : { id: 107, login: "test-user", email: "test@example.com" },
          ),
        ),
      auth: {
        userStore: createPrismaUserStore(prisma),
        jwtSigner: signer,
        sessionStore: store,
        refreshVerifier: createRs256RefreshVerifier(keys.publicKey),
      },
    },
  );
  class TestModule {}
  Module({
    controllers: [AuthController, SessionController],
    providers: [
      { provide: AUTH_CONFIG, useValue: config },
      { provide: OAUTH_USECASES, useValue: oauth },
    ],
  })(TestModule);
  app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  app.use(cookieParser());
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

describe("real DB and HTTP auth lifecycle", () => {
  it("콜백 세션 저장 → 회전 → 이전 토큰 거부 → 로그아웃 → 재발급 거부", async () => {
    const a = await login();
    const claims = await decode(a);
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { id: claims.sid as string },
    });
    expect(session.currentRefreshJti).toBe(claims.jti);
    expect(claims.exp! - claims.iat!).toBe(1209600);
    const b = await post("/auth/refresh", refreshCookie(a));
    expect(b.status).toBe(204);
    expect(b.headers.get("cache-control")).toBe("no-store");
    const next = await decode(b);
    expect(next.exp).toBe(claims.exp);
    expect(next.jti).not.toBe(claims.jti);
    const old = await post("/auth/refresh", refreshCookie(a));
    expect(old.status).toBe(401);
    expect(old.headers.getSetCookie()).toEqual([]);
    const c = await post("/auth/refresh", refreshCookie(b));
    expect(c.status).toBe(204);
    const logout = await post("/auth/logout", refreshCookie(c));
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^access_token=;.*Path=\/;/),
        expect.stringMatching(/^refresh_token=;.*Path=\/auth;/),
      ]),
    );
    expect(
      logout.headers
        .getSetCookie()
        .every((c) => c.includes("Expires=Thu, 01 Jan 1970") && c.includes("HttpOnly")),
    ).toBe(true);
    expect((await post("/auth/refresh", refreshCookie(c))).status).toBe(401);
    expect((await post("/auth/logout", refreshCookie(c))).status).toBe(204);
  });
  it("병렬 회전은 하나만 성공하며 새 토큰과 다른 로그인 세션을 유지한다", async () => {
    const a = await login();
    const other = await login();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post("/auth/refresh", refreshCookie(a))),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    const winner = results.find((r) => r.status === 204)!;
    expect((await post("/auth/refresh", refreshCookie(winner))).status).toBe(204);
    expect((await post("/auth/logout", refreshCookie(a))).status).toBe(204);
    expect((await post("/auth/refresh", refreshCookie(other))).status).toBe(204);
  });
  it("refresh/logout 경합이 폐기된 세션을 되살리지 않는다", async () => {
    const a = await login();
    const claims = await decode(a);
    const [refresh, logout] = await Promise.all([
      post("/auth/refresh", refreshCookie(a)),
      post("/auth/logout", refreshCookie(a)),
    ]);
    expect(logout.status).toBe(204);
    expect([204, 401]).toContain(refresh.status);
    expect(
      (await prisma.authSession.findUniqueOrThrow({ where: { id: claims.sid as string } }))
        .revokedAt,
    ).not.toBeNull();
    if (refresh.status === 204)
      expect((await post("/auth/refresh", refreshCookie(refresh))).status).toBe(401);
  });
  it("CSRF는 누락/null/다른 origin을 거부하며 세션이나 쿠키를 변경하지 않는다", async () => {
    const a = await login();
    for (const bad of [
      "",
      "null",
      "http://localhost:5174",
      "http://localhost:5173.evil.test",
      "https://evil.test",
    ]) {
      for (const route of ["refresh", "logout"]) {
        const r = await post(`/auth/${route}`, refreshCookie(a), bad);
        expect(r.status).toBe(403);
        expect(r.headers.getSetCookie()).toEqual([]);
      }
    }
    const missing = await fetch(base + "/auth/logout", {
      method: "POST",
      headers: { Cookie: refreshCookie(a) },
    });
    expect(missing.status).toBe(403);
    expect((await post("/auth/refresh", refreshCookie(a))).status).toBe(204);
  });
  it("access/기존 refresh/만료/위조/누락 토큰은 401, 무효 로그아웃은 204", async () => {
    const a = await login();
    const c = await decode(a);
    const now = Math.floor(Date.now() / 1000);
    const { SignJWT, importPKCS8 } = await import("jose");
    const key = await importPKCS8(keys.privateKey, "RS256");
    const old = await new SignJWT({ sub: c.sub, type: "refresh", iat: now, exp: now + 100 })
      .setProtectedHeader({ alg: "RS256" })
      .sign(key);
    const expired = await signer.sign({
      sub: c.sub!,
      type: "refresh",
      sid: c.sid as string,
      jti: c.jti!,
      iat: now - 100,
      exp: now - 1,
    });
    for (const value of [
      "",
      "refresh_token=invalid",
      `refresh_token=${old}`,
      `refresh_token=${expired}`,
      cookie(a, "access_token").replace("access_token=", "refresh_token="),
    ]) {
      expect((await post("/auth/refresh", value)).status).toBe(401);
      expect((await post("/auth/logout", value)).status).toBe(204);
    }
  });
  it("DB 장애를 인증 실패나 로그아웃 성공으로 숨기지 않는다", async () => {
    const a = await login();
    const lookup = vi.spyOn(store, "find").mockRejectedValueOnce(new Error("database unavailable"));
    try {
      const r = await post("/auth/refresh", refreshCookie(a));
      expect(r.status).toBe(500);
      expect(r.headers.getSetCookie()).toEqual([]);
    } finally {
      lookup.mockRestore();
    }
    const revoke = vi
      .spyOn(store, "revoke")
      .mockRejectedValueOnce(new Error("database unavailable"));
    try {
      const r = await post("/auth/logout", refreshCookie(a));
      expect(r.status).toBe(500);
      expect(r.headers.getSetCookie()).toEqual([]);
    } finally {
      revoke.mockRestore();
    }
    expect((await post("/auth/refresh", refreshCookie(a))).status).toBe(204);
  });
  it("쿠키 경로·HttpOnly·SameSite·Secure와 고정 만료 잔여기간", async () => {
    const a = await login();
    expect(cookie(a, "access_token")).toMatch(/^access_token=/);
    expect(a.headers.getSetCookie().find((c) => c.startsWith("access_token="))).toMatch(
      /Path=\/;.*HttpOnly.*SameSite=Lax/,
    );
    const c = await decode(a);
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const jti = randomUUID();
    await prisma.authSession.update({
      where: { id: c.sid as string },
      data: { expiresAt: new Date(expiresAt * 1000), currentRefreshJti: jti },
    });
    const token = await signer.sign({
      sub: c.sub!,
      type: "refresh",
      sid: c.sid as string,
      jti,
      iat: expiresAt - 120,
      exp: expiresAt,
    });
    Object.assign(config, { cookieSecure: true });
    try {
      const b = await post("/auth/refresh", `refresh_token=${token}`);
      expect(b.status).toBe(204);
      const header = b.headers.getSetCookie().find((c) => c.startsWith("refresh_token="))!;
      expect(header).toMatch(/Path=\/auth;/);
      expect(header).toContain("Secure");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(Number(/Max-Age=(\d+)/.exec(header)![1])).toBeLessThanOrEqual(120);
      expect((await decode(b)).exp).toBe(expiresAt);
    } finally {
      Object.assign(config, { cookieSecure: false });
    }
  });
});
