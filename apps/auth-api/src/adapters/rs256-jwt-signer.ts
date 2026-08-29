import type { JwtSignerPort } from "@wake-surfer/oauth";

const ALGORITHM = "RS256";

/** jose는 ESM 전용이라 CommonJS인 이 앱에서는 동적 import로 불러온다. */
type Jose = typeof import("jose", { with: { "resolution-mode": "import" } });

/**
 * 클레임을 RS256으로 서명하는 JwtSignerPort 구현.
 *
 * 개인키는 이 서비스에만 있고, 검증하는 쪽에는 공개키만 배포한다.
 * 라이브러리가 조립한 클레임을 그대로 서명한다 — 여기서 항목을 추가하지 않는다.
 */
export function createRs256JwtSigner(privateKeyPem: string): JwtSignerPort {
  // 모듈 로드와 키 파싱은 첫 서명 때 한 번만 하고 재사용한다.
  let prepared: Promise<{ jose: Jose; privateKey: Awaited<ReturnType<Jose["importPKCS8"]>> }>;

  function prepare(): typeof prepared {
    prepared ??= (async () => {
      const jose: Jose = await import("jose");
      return { jose, privateKey: await jose.importPKCS8(privateKeyPem, ALGORITHM) };
    })();
    return prepared;
  }

  return {
    sign: async (claims) => {
      const { jose, privateKey } = await prepare();
      return new jose.SignJWT({ type: claims.type })
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(claims.sub)
        .setIssuedAt(claims.iat)
        .setExpirationTime(claims.exp)
        .sign(privateKey);
    },
  };
}
