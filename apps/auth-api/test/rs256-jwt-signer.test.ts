import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createRs256JwtSigner } from "../src/adapters/rs256-jwt-signer";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const claims = {
  sub: "a3f1-our-user-id",
  type: "access",
  iat: 1_700_000_000,
  exp: 1_700_001_800,
} as const;

describe("createRs256JwtSigner", () => {
  it("서명한 토큰이 공개키로 검증된다", async () => {
    const { importSPKI, jwtVerify } = await import("jose");
    const signer = createRs256JwtSigner(privateKey);

    const token = await signer.sign(claims);
    const { payload, protectedHeader } = await jwtVerify(
      token,
      await importSPKI(publicKey, "RS256"),
      { currentDate: new Date(claims.iat * 1000) },
    );

    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.sub).toBe(claims.sub);
    expect(payload.type).toBe("access");
    expect(payload.iat).toBe(claims.iat);
    expect(payload.exp).toBe(claims.exp);
  });

  it("다른 키로는 검증되지 않는다", async () => {
    const { importSPKI, jwtVerify } = await import("jose");
    const other = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const token = await createRs256JwtSigner(privateKey).sign(claims);

    await expect(jwtVerify(token, await importSPKI(other.publicKey, "RS256"))).rejects.toThrow();
  });

  it("클레임에 개인정보를 추가하지 않는다", async () => {
    const token = await createRs256JwtSigner(privateKey).sign(claims);
    const [, payloadPart = ""] = token.split(".");
    const payload: unknown = JSON.parse(Buffer.from(payloadPart, "base64url").toString());

    expect(Object.keys(payload as object).sort()).toEqual(["exp", "iat", "sub", "type"]);
  });

  it("refresh 토큰은 type으로 구분된다", async () => {
    const signer = createRs256JwtSigner(privateKey);
    const { decodeJwt } = await import("jose");

    const refresh = await signer.sign({ ...claims, type: "refresh" });

    expect(decodeJwt(refresh).type).toBe("refresh");
  });
});
