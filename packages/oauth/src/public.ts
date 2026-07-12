// 진입점
export { createOAuthUsecases } from "./application/create-usecases";
export type { OAuthUsecases } from "./application/create-usecases";
export type { StartGithubLoginResult } from "./application/start-github-login.usecase";
export type {
  HandleGithubCallbackResult,
  OAuthCallbackErrorCode,
} from "./application/handle-github-callback.usecase";
export type { FetchGithubUserByCodeResult } from "./application/fetch-github-user-by-code.usecase";
export type { GithubUser } from "./infrastructure/github/fetch-github-user";

// 설정
export { assertValidOAuthConfig, OAuthConfigError } from "./domain/oauth-config";
export type { OAuthConfig } from "./domain/oauth-config";
export type { OAuthProviderError } from "./domain/oauth-provider-error";

// 포트
export type { OAuthCsrfStateStorePort } from "./runtime-deps";

// 기본 어댑터: signed httpOnly 쿠키 기반 StateStore
export { createCookieStateStore } from "./infrastructure/cookie/cookie-state-store";
export type {
  CookieAttributes,
  CookieJar,
  CookieStateStoreConfig,
  SameSite,
} from "./infrastructure/cookie/cookie-state-store";
