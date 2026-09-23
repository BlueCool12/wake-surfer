import type { RefreshTokenVerifierPort } from "@wake-surfer/oauth";
type Jose = typeof import("jose", { with: { "resolution-mode": "import" } });

export function createRs256RefreshVerifier(publicKeyPem: string): RefreshTokenVerifierPort {
  let prepared: Promise<{ jose: Jose; key: Awaited<ReturnType<Jose["importSPKI"]>> }>;
  return {
    async verify(token, now) {
      // 키 설정 오류는 인증 실패로 숨기지 않는다.
      prepared ??= (async () => {
        const jose: Jose = await import("jose");
        return { jose, key: await jose.importSPKI(publicKeyPem, "RS256") };
      })();
      const { jose, key } = await prepared;
      try {
        const { payload: p } = await jose.jwtVerify(token, key, {
          algorithms: ["RS256"],
          currentDate: new Date(now * 1000),
          requiredClaims: ["sub", "iat", "exp", "type", "sid", "jti"],
        });
        if (
          p.type !== "refresh" ||
          typeof p.sub !== "string" ||
          !p.sub.trim() ||
          typeof p.sid !== "string" ||
          !p.sid.trim() ||
          typeof p.jti !== "string" ||
          !p.jti.trim() ||
          !Number.isSafeInteger(p.iat) ||
          !Number.isSafeInteger(p.exp) ||
          p.iat! > now ||
          p.exp! <= p.iat!
        )
          return undefined;
        return { sub: p.sub, type: "refresh", sid: p.sid, jti: p.jti, iat: p.iat!, exp: p.exp! };
      } catch (error) {
        if (error instanceof jose.errors.JOSEError) return undefined;
        throw error;
      }
    },
  };
}
