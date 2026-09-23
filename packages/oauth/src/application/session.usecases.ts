import { randomUUID } from "node:crypto";
import type { AuthTokens } from "../domain/auth-token";
import type {
  AuthSessionStorePort,
  JwtSignerPort,
  RefreshTokenVerifierPort,
} from "../runtime-deps";

export type SessionDependencies = {
  sessionStore: AuthSessionStorePort;
  verifier: RefreshTokenVerifierPort;
  signer: JwtSignerPort;
  accessTtlSec: number;
  now?: () => number;
};
export type RefreshResult =
  { status: "ok"; tokens: AuthTokens } | { status: "rejected"; reason: "INVALID_REFRESH_TOKEN" };

export async function refreshAuthTokens(
  deps: SessionDependencies,
  token: string | undefined,
): Promise<RefreshResult> {
  const rejected = { status: "rejected", reason: "INVALID_REFRESH_TOKEN" } as const;
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (!token) return rejected;
  const claims = await deps.verifier.verify(token, now);
  if (!claims) return rejected;
  const session = await deps.sessionStore.find(claims.sid);
  if (
    !session ||
    session.userId !== claims.sub ||
    session.currentRefreshJti !== claims.jti ||
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.expiresAt !== claims.exp
  )
    return rejected;
  const jti = randomUUID();
  const accessExpiresAt = now + deps.accessTtlSec;
  // 최초 로그인 만료 시점을 유지한다.
  const refreshExpiresAt = session.expiresAt;
  const accessToken = await deps.signer.sign({
    sub: claims.sub,
    type: "access",
    iat: now,
    exp: accessExpiresAt,
  });
  const refreshToken = await deps.signer.sign({
    sub: claims.sub,
    type: "refresh",
    sid: claims.sid,
    jti,
    iat: now,
    exp: refreshExpiresAt,
  });
  const rotated = await deps.sessionStore.rotate({
    id: session.id,
    userId: claims.sub,
    previousJti: claims.jti,
    nextJti: jti,
    now: (deps.now ?? (() => Math.floor(Date.now() / 1000)))(),
  });
  if (!rotated) return rejected;
  return { status: "ok", tokens: { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt } };
}

export async function logoutSession(
  deps: SessionDependencies,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const claims = await deps.verifier.verify(token, now);
  // 검증되지 않은 sid로 저장소를 수정하지 않는다. 이전 토큰도 같은 세션 로그아웃은 가능하다.
  if (claims) await deps.sessionStore.revoke(claims.sid, claims.sub, now);
}
