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

/** 유스케이스가 주입받는 런타임 의존성 묶음. */
export type OAuthRuntimeDeps = {
  stateStore: OAuthCsrfStateStorePort;
};
