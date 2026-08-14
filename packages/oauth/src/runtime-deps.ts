import type { AuthTokenClaims } from "./domain/auth-token";
import type { AuthenticatedUser } from "./domain/auth-user";

/**
 * CSRF 방지용 state를 저장·검증하는 포트.
 *
 * 계약: `verify()`는 일치 여부를 반환하고, 성공/실패와 무관하게 저장된 state를
 * 소비(삭제)해야 한다 — 같은 state를 두 번 통과시키면 안 된다(재사용 공격 차단).
 * 구현은 동기/비동기 모두 허용한다.
 */
export type OAuthCsrfStateStorePort = {
  save: (state: string) => void | Promise<void>;
  verify: (state: string) => boolean | Promise<boolean>;
};

/**
 * GitHub 신원으로 우리 회원을 조회/생성하는 포트.
 *
 * 매핑 키는 `(provider, providerUserId)` — provider를 인자로 받아 미래에 다른 로그인 수단
 * (카카오·이메일 등)이 붙어도 구조가 유지된다. 이메일은 계정 유일키로 쓰지 않는다.
 * 실제 DB 구현은 apps가 주입한다.
 */
export type UserStorePort = {
  findByProvider: (
    provider: string,
    providerUserId: string,
  ) => (AuthenticatedUser | undefined) | Promise<AuthenticatedUser | undefined>;
  create: (input: {
    readonly provider: string;
    readonly providerUserId: string;
    readonly email: string;
    readonly login: string;
  }) => AuthenticatedUser | Promise<AuthenticatedUser>;
};

/**
 * 클레임을 서명된 토큰 문자열로 바꾸는 포트.
 *
 * HS256 등 서명 알고리즘·비밀키는 apps 어댑터 소관이다. 이 패키지는 "무엇을 서명하는가"
 * (클레임 계약)만 책임지고, "어떻게 서명하는가"는 위임한다.
 */
export type JwtSignerPort = {
  sign: (claims: AuthTokenClaims) => string | Promise<string>;
};
