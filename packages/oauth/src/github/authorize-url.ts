import { assertValidOAuthConfig, type OAuthConfig } from "../domain/oauth-config";

/**
 * GitHub.com의 기본 authorize 엔드포인트.
 *
 * GitHub Enterprise나 테스트에서는 `OAuthConfig.authorizeBaseUrl`로 교체할 수 있다.
 */
export const DEFAULT_GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/**
 * GitHub OAuth authorize URL을 만든다. (순수 함수)
 *
 * - client_id / redirect_uri / scope / state를 쿼리 파라미터로 조립한다.
 * - scope는 GitHub 규격대로 공백으로 이어 붙인다. (최소 권한 원칙은 config가 책임진다)
 * - 조립 전에 `assertValidOAuthConfig`로 redirect_uri 화이트리스트를 강제한다.
 *   redirect_uri가 실제로 URL에 실리는 지점이 여기이므로, open redirect 방어를 이 시점에 둔다.
 */
export function createAuthorizeUrl(config: OAuthConfig, state: string): string {
  assertValidOAuthConfig(config);
  if (state.trim() === "") {
    throw new Error("state must not be empty");
  }

  const url = new URL(config.authorizeBaseUrl ?? DEFAULT_GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}
