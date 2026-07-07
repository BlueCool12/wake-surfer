/**
 * 이 패키지의 공개 표면(public surface).
 *
 * 외부(apps/)에 공개할 것만 여기서 선별해 재노출한다. 여기 없는 것은 내부 구현이며,
 * 예고 없이 바뀔 수 있다. (예: issueState, createAuthorizeUrl은 유스케이스 내부에서만 쓰인다)
 */

// 진입점: 앱 부팅 시 config를 주입해 유스케이스 묶음을 만든다.
export { createOAuthUsecases } from "./application/create-usecases";
export type { OAuthUsecases } from "./application/create-usecases";
export type { StartGithubLoginResult } from "./application/start-github-login.usecase";

// 설정: 값 객체 + 부팅 시점 사전 검증용.
export { assertValidOAuthConfig, OAuthConfigError } from "./domain/oauth-config";
export type { OAuthConfig } from "./domain/oauth-config";

// 포트: 앱(또는 어댑터)이 구현해 주입하는 계약.
export type { OAuthRuntimeDeps, StateStorePort } from "./runtime-deps";

// 기본 어댑터: signed httpOnly 쿠키 기반 StateStore.
export { createCookieStateStore } from "./cookie/cookie-state-store";
export type {
  CookieAttributes,
  CookieJar,
  CookieStateStoreConfig,
  SameSite,
} from "./cookie/cookie-state-store";
