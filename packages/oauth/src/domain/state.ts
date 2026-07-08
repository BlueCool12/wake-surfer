import { randomBytes as nodeRandomBytes } from "node:crypto";

/**
 * CSRF 방지용 state의 최소/기본 엔트로피 바이트 수.
 *
 * 이슈 #5 수용 기준: "state에는 충분한 엔트로피(crypto-random 32바이트 이상)를 사용한다."
 * 따라서 최소이자 기본값을 32바이트(256비트)로 둔다.
 */
export const MIN_STATE_BYTES = 32;

export type IssueStateOptions = {
  /** 엔트로피 바이트 수. 기본이자 최소는 32바이트. */
  readonly byteLength?: number;
  /**
   * 난수 생성기 주입 지점.
   * 기본은 node:crypto의 CSPRNG. 테스트에서 결정론적 값을 넣기 위해 교체할 수 있다.
   */
  readonly randomBytes?: (size: number) => Buffer;
};

/**
 * 충분한 엔트로피를 가진 CSRF state 문자열을 발급한다. (순수 함수)
 *
 * - 암호학적으로 안전한 난수(CSPRNG)를 사용한다.
 * - URL-safe한 base64url로 인코딩해 쿼리 파라미터로 그대로 실을 수 있게 한다.
 */
export function issueState(options: IssueStateOptions = {}): string {
  const byteLength = options.byteLength ?? MIN_STATE_BYTES;
  if (byteLength < MIN_STATE_BYTES) {
    throw new Error(
      `state byteLength must be at least ${MIN_STATE_BYTES} bytes for sufficient entropy`,
    );
  }
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  return randomBytes(byteLength).toString("base64url");
}
