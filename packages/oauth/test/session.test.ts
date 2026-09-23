import { describe, expect, it } from "vitest";
import { issueAuthTokens } from "../src/application/issue-auth-tokens.usecase";
import { logoutSession, refreshAuthTokens } from "../src/application/session.usecases";
import type { RefreshTokenClaims } from "../src/domain/auth-token";
import { memorySessions } from "./session-store.fake";

function fixture() {
  let time = 1000;
  const deps = {
    sessionStore: memorySessions(),
    signer: { sign: async (c: object) => JSON.stringify(c) },
    verifier: {
      verify: async (s: string, now: number) => {
        const c = JSON.parse(s) as RefreshTokenClaims;
        return c.type === "refresh" && c.exp > now ? c : undefined;
      },
    },
    accessTtlSec: 1800,
    refreshTtlSec: 1209600,
    now: () => time,
  };
  return {
    deps,
    tick: (n: number) => {
      time += n;
    },
    issue: () => issueAuthTokens({ ...deps, user: { id: "user" } }),
  };
}
describe("refresh and logout", () => {
  it("최초 만료 유지, ID 교체, 이전 토큰만 거부하고 새 토큰 유지", async () => {
    const f = fixture();
    const original = await f.issue();
    f.tick(60);
    const result = await refreshAuthTokens(f.deps, original.refreshToken);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.tokens.refreshExpiresAt).toBe(original.refreshExpiresAt);
    expect(result.tokens.accessExpiresAt).toBe(2860);
    expect(result.tokens.refreshToken).not.toBe(original.refreshToken);
    expect((await refreshAuthTokens(f.deps, original.refreshToken)).status).toBe("rejected");
    expect((await refreshAuthTokens(f.deps, result.tokens.refreshToken)).status).toBe("ok");
  });
  it("동시에 같은 토큰으로 교체하면 하나만 성공한다", async () => {
    const f = fixture();
    const t = await f.issue();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => refreshAuthTokens(f.deps, t.refreshToken)),
    );
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
  });
  it("현재 세션만 로그아웃하며 반복/누락 로그아웃은 성공한다", async () => {
    const f = fixture();
    const a = await f.issue();
    const b = await f.issue();
    await logoutSession(f.deps, a.refreshToken);
    await logoutSession(f.deps, a.refreshToken);
    await logoutSession(f.deps, undefined);
    expect((await refreshAuthTokens(f.deps, a.refreshToken)).status).toBe("rejected");
    expect((await refreshAuthTokens(f.deps, b.refreshToken)).status).toBe("ok");
  });
  it("교체된 토큰으로도 같은 세션 로그아웃은 가능하다", async () => {
    const f = fixture();
    const a = await f.issue();
    const b = await refreshAuthTokens(f.deps, a.refreshToken);
    await logoutSession(f.deps, a.refreshToken);
    if (b.status !== "ok") throw new Error("expected success");
    expect((await refreshAuthTokens(f.deps, b.tokens.refreshToken)).status).toBe("rejected");
  });
  it("만료, access, 누락, 소유자 불일치를 거부한다", async () => {
    const f = fixture();
    const a = await f.issue();
    expect((await refreshAuthTokens(f.deps, undefined)).status).toBe("rejected");
    expect((await refreshAuthTokens(f.deps, a.accessToken)).status).toBe("rejected");
    expect(
      (
        await refreshAuthTokens(
          f.deps,
          JSON.stringify({ ...JSON.parse(a.refreshToken), sub: "other" }),
        )
      ).status,
    ).toBe("rejected");
    f.tick(1209600);
    expect((await refreshAuthTokens(f.deps, a.refreshToken)).status).toBe("rejected");
  });
  it("서명 실패 시 이전 토큰 유지, 저장소 장애는 전파한다", async () => {
    const f = fixture();
    const a = await f.issue();
    await expect(
      refreshAuthTokens(
        {
          ...f.deps,
          signer: {
            sign: async () => {
              throw new Error("sign failed");
            },
          },
        },
        a.refreshToken,
      ),
    ).rejects.toThrow("sign failed");
    expect((await refreshAuthTokens(f.deps, a.refreshToken)).status).toBe("ok");
    await expect(
      issueAuthTokens({
        ...f.deps,
        user: { id: "user" },
        sessionStore: {
          ...f.deps.sessionStore,
          create: async () => {
            throw new Error("db failed");
          },
        },
      }),
    ).rejects.toThrow("db failed");
  });
});
