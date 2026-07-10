import { assertValidOAuthConfig, type OAuthConfig } from "../../domain/oauth-config";

/** GitHub.com 기본 authorize 엔드포인트. (GHE·테스트는 OAuthConfig.authorizeBaseUrl로 교체) */
export const DEFAULT_GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/** GitHub OAuth authorize URL을 만든다. (순수 함수) */
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
