import { randomUUID } from "node:crypto";
import type { AuthTokens } from "../domain/auth-token";
import type { AuthenticatedUser } from "../domain/auth-user";
import type { AuthSessionStorePort, JwtSignerPort } from "../runtime-deps";

export type IssueAuthTokensInput = {
  readonly user: AuthenticatedUser;
  readonly signer: JwtSignerPort;
  readonly sessionStore: AuthSessionStorePort;
  readonly accessTtlSec: number;
  readonly refreshTtlSec: number;
  readonly now?: () => number;
};

/** 서명과 세션 저장이 모두 성공한 경우에만 토큰을 반환한다. */
export async function issueAuthTokens(input: IssueAuthTokensInput): Promise<AuthTokens> {
  const iat = (input.now ?? (() => Math.floor(Date.now() / 1000)))();
  const sid = randomUUID();
  const jti = randomUUID();
  const accessExpiresAt = iat + input.accessTtlSec;
  const refreshExpiresAt = iat + input.refreshTtlSec;
  const accessToken = await input.signer.sign({
    sub: input.user.id,
    type: "access",
    iat,
    exp: accessExpiresAt,
  });
  const refreshToken = await input.signer.sign({
    sub: input.user.id,
    type: "refresh",
    sid,
    jti,
    iat,
    exp: refreshExpiresAt,
  });
  await input.sessionStore.create({
    id: sid,
    userId: input.user.id,
    currentRefreshJti: jti,
    expiresAt: refreshExpiresAt,
    revokedAt: null,
  });
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}
