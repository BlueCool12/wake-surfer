import type { AuthTokens } from "../domain/auth-token";
import type { AuthenticatedUser } from "../domain/auth-user";
import type { JwtSignerPort } from "../runtime-deps";

export type IssueAuthTokensInput = {
  readonly user: AuthenticatedUser;
  readonly signer: JwtSignerPort;
  /** access 토큰 수명(초). */
  readonly accessTtlSec: number;
  /** refresh 토큰 수명(초). */
  readonly refreshTtlSec: number;
  /** 현재 시각(epoch seconds). 테스트에서 고정 주입. 기본은 실제 시계. */
  readonly now?: () => number;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 회원에게 access + refresh JWT를 발급한다.
 *
 * 클레임 조립(sub=우리 회원 id, type, iat, exp)은 여기서 하고, 실제 서명은 signer 포트에
 * 위임한다. iat은 한 번만 읽어 두 토큰이 같은 발급 시각을 공유한다.
 */
export async function issueAuthTokens(input: IssueAuthTokensInput): Promise<AuthTokens> {
  const iat = (input.now ?? nowSeconds)();

  const accessToken = await input.signer.sign({
    sub: input.user.id,
    type: "access",
    iat,
    exp: iat + input.accessTtlSec,
  });
  const refreshToken = await input.signer.sign({
    sub: input.user.id,
    type: "refresh",
    iat,
    exp: iat + input.refreshTtlSec,
  });

  return { accessToken, refreshToken };
}
