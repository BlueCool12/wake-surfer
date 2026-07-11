import { randomBytes as nodeRandomBytes } from "node:crypto";

/**
 * OAuth CSRF state의 최소/기본 엔트로피 바이트 수. (crypto-random 32바이트 = 256비트)
 */
export const MIN_OAUTH_CSRF_STATE_BYTES = 32;

export type IssueOAuthCsrfStateOptions = {
  readonly byteLength?: number;
  /** 난수 생성기 주입 지점(테스트에서 결정론적 값 주입용). 기본은 node:crypto CSPRNG. */
  readonly randomBytes?: (size: number) => Buffer;
};

/**
 * OAuth 로그인 CSRF 방지용 state 문자열을 발급한다. (순수 함수)
 *
 * base64url로 인코딩해 쿼리 파라미터에 그대로 실을 수 있게 한다.
 */
export function issueOAuthCsrfState(options: IssueOAuthCsrfStateOptions = {}): string {
  const byteLength = options.byteLength ?? MIN_OAUTH_CSRF_STATE_BYTES;
  if (byteLength < MIN_OAUTH_CSRF_STATE_BYTES) {
    throw new Error(
      `state byteLength must be at least ${MIN_OAUTH_CSRF_STATE_BYTES} bytes for sufficient entropy`,
    );
  }
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  return randomBytes(byteLength).toString("base64url");
}
