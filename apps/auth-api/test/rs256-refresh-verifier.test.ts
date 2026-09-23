import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRs256RefreshVerifier } from "../src/adapters/rs256-refresh-verifier";
import { createRs256JwtSigner } from "../src/adapters/rs256-jwt-signer";
const pair = () =>
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
const keys = pair();
const verifier = createRs256RefreshVerifier(keys.publicKey);
const claims = {
  sub: "user",
  type: "refresh",
  sid: "session",
  jti: "token",
  iat: 1000,
  exp: 2000,
} as const;
async function signed(payload: Record<string, unknown>, algorithm = "RS256") {
  const { SignJWT, importPKCS8 } = await import("jose");
  const key =
    algorithm === "HS256"
      ? new TextEncoder().encode("test-secret-with-enough-entropy-123456")
      : await importPKCS8(keys.privateKey, algorithm);
  return new SignJWT(payload).setProtectedHeader({ alg: algorithm }).sign(key);
}
describe("refresh JWT verification", () => {
  it("서명 어댑터가 sid/jti를 보존하고 공개키로 검증된다", async () => {
    expect(
      await verifier.verify(await createRs256JwtSigner(keys.privateKey).sign(claims), 1000),
    ).toEqual(claims);
  });
  it("다른 키, 만료, 변조를 거부한다", async () => {
    expect(
      await verifier.verify(await createRs256JwtSigner(pair().privateKey).sign(claims), 1000),
    ).toBeUndefined();
    const token = await signed(claims);
    expect(await verifier.verify(token, 2000)).toBeUndefined();
    expect(await verifier.verify(token + "broken", 1000)).toBeUndefined();
  });
  it("HS256, access, 기존 refresh와 잘못된 클레임을 거부한다", async () => {
    expect(await verifier.verify(await signed(claims, "HS256"), 1000)).toBeUndefined();
    for (const overrides of [
      { type: "access" },
      { sid: undefined },
      { jti: undefined },
      { sub: "" },
      { iat: "1000" },
      { iat: 1001 },
      { exp: undefined },
      { exp: 1000.5 },
      { jti: 10 },
    ]) {
      expect(
        await verifier.verify(await signed({ ...claims, ...overrides }), 1000),
      ).toBeUndefined();
    }
  });
  it("키 설정 오류는 서버 오류로 전파한다", async () => {
    await expect(
      createRs256RefreshVerifier("bad key").verify(await signed(claims), 1000),
    ).rejects.toThrow();
  });
});
