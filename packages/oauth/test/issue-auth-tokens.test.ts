import { describe, expect, it } from "vitest";

import type { AuthTokenClaims } from "../src/domain/auth-token";
import { issueAuthTokens } from "../src/application/issue-auth-tokens.usecase";
import type { JwtSignerPort } from "../src/runtime-deps";

/** 서명 요청을 기록하고, 클레임을 식별 가능한 문자열로 되돌려주는 가짜 signer. */
function fakeSigner() {
  const calls: AuthTokenClaims[] = [];
  const signer: JwtSignerPort = {
    sign: (claims) => {
      calls.push(claims);
      return `${claims.type}:${claims.sub}:${claims.exp}`;
    },
  };
  return { signer, calls };
}

const baseInput = {
  user: { id: "user-1" },
  accessTtlSec: 1800,
  refreshTtlSec: 1_209_600,
  now: () => 1_000_000,
};

describe("issueAuthTokens", () => {
  it("access·refresh 클레임을 조립해 각각 서명한다 (iat 공유, exp=iat+ttl)", async () => {
    const { signer, calls } = fakeSigner();
    await issueAuthTokens({ ...baseInput, signer });
    expect(calls).toEqual([
      { sub: "user-1", type: "access", iat: 1_000_000, exp: 1_001_800 },
      { sub: "user-1", type: "refresh", iat: 1_000_000, exp: 2_209_600 },
    ]);
  });

  it("sub은 우리 회원 id다 (GitHub id 아님)", async () => {
    const { signer, calls } = fakeSigner();
    await issueAuthTokens({ ...baseInput, user: { id: "our-99" }, signer });
    expect(calls.every((c) => c.sub === "our-99")).toBe(true);
  });

  it("반환의 accessToken/refreshToken이 각 서명 결과에 매핑된다", async () => {
    const { signer } = fakeSigner();
    const tokens = await issueAuthTokens({ ...baseInput, signer });
    expect(tokens).toEqual({
      accessToken: "access:user-1:1001800",
      refreshToken: "refresh:user-1:2209600",
    });
  });

  it("now 미주입 시 실제 시계를 쓴다 (exp-iat는 여전히 ttl)", async () => {
    const { signer, calls } = fakeSigner();
    const before = Math.floor(Date.now() / 1000);
    await issueAuthTokens({ user: { id: "u" }, signer, accessTtlSec: 60, refreshTtlSec: 120 });
    const access = calls[0]!;
    expect(access.iat).toBeGreaterThanOrEqual(before);
    expect(access.exp - access.iat).toBe(60);
    expect(calls[1]!.exp - calls[1]!.iat).toBe(120);
  });
});
