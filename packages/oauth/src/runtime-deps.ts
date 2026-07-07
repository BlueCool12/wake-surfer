/**
 * 이 라이브러리가 바깥세상(저장소 등)에 요구하는 계약(포트) 정의.
 *
 * 헥사고날 아키텍처의 "포트"에 해당한다. 구현체(어댑터)는 이 패키지를 쓰는
 * `apps/` 서버나 별도 어댑터가 제공한다. (예: signed cookie 기반, Redis 기반)
 * 도메인/유스케이스는 이 인터페이스에만 의존하고, 실제 구현은 주입받는다.
 */

/**
 * CSRF 방지용 state를 저장하고 검증하는 포트.
 *
 * 전형적 흐름:
 *  1) 로그인 시작 시 `issueState()`로 만든 state를 `save()`로 보관한다.
 *  2) GitHub 콜백에서 돌아온 state를 `verify()`로 대조한다.
 *
 * 계약(구현이 반드시 지켜야 하는 규칙):
 *  - `verify()`는 **일치 여부를 반환**하고, 성공/실패와 무관하게 저장된 state를
 *    **소비(삭제)** 해야 한다. 같은 state를 두 번 통과시키면 안 된다(재사용 공격 차단).
 *  - 구현은 동기/비동기 모두 허용한다. (쿠키=동기, Redis=비동기 등)
 */
export type StateStorePort = {
  /** 발급한 state를 보관한다. */
  save: (state: string) => void | Promise<void>;
  /**
   * 콜백에서 돌아온 state가 보관된 값과 일치하는지 검증하고, 보관값을 소비한다.
   * @returns 일치하면 true, 아니면 false
   */
  verify: (state: string) => boolean | Promise<boolean>;
};

/**
 * 이 라이브러리의 유스케이스가 주입받는 런타임 의존성 묶음.
 * (Phase E의 유스케이스 팩토리가 이 값을 인자로 받는다)
 */
export type OAuthRuntimeDeps = {
  stateStore: StateStorePort;
};
