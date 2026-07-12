// 진입점
export { createOAuthUsecases } from "./application/create-usecases";
export type { OAuthUsecases } from "./application/create-usecases";
export type { StartGithubLoginResult } from "./application/start-github-login.usecase";
export type {
  HandleGithubCallbackResult,
  OAuthCallbackErrorCode,
  OAuthProviderError,
} from "./application/handle-github-callback.usecase";

// 설정
export { assertValidOAuthConfig, OAuthConfigError } from "./domain/oauth-config";
export type { OAuthConfig } from "./domain/oauth-config";

// 포트
export type { OAuthCsrfStateStorePort, OAuthRuntimeDeps } from "./runtime-deps";

// 기본 어댑터: signed httpOnly 쿠키 기반 StateStore
export { createCookieStateStore } from "./infrastructure/cookie/cookie-state-store";
export type {
  CookieAttributes,
  CookieJar,
  CookieStateStoreConfig,
  SameSite,
} from "./infrastructure/cookie/cookie-state-store";
