/**
 * GitHub OAuth App 설정값 (도메인 값 객체).
 *
 * 이 라이브러리는 순수 로직 계층이므로 `process.env`를 직접 읽지 않는다.
 * 값 주입은 이 패키지를 사용하는 `apps/` 서버의 책임이다.
 */
export interface OAuthConfig {
  /** GitHub OAuth App의 client_id. */
  readonly clientId: string;
  /** 이번 인증에 사용할 콜백 URL. `allowedRedirectUris` 중 하나여야 한다. */
  readonly redirectUri: string;
  /** 요청 scope 목록. 최소 권한 원칙에 따라 최소한으로 유지한다. (예: ["user:email"]) */
  readonly scopes: readonly string[];
  /** 허용된 콜백 URL 화이트리스트. open redirect 방지를 위해 정확히 일치하는 값만 허용한다. */
  readonly allowedRedirectUris: readonly string[];
  /**
   * authorize 엔드포인트 오버라이드.
   * 테스트나 GitHub Enterprise 대응용. 미지정 시 github.com을 사용한다.
   */
  readonly authorizeBaseUrl?: string;
}

/** 설정값이 유효하지 않을 때 던지는 도메인 에러. */
export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigError";
  }
}

/**
 * OAuthConfig가 유효한지 검증한다. 위반 시 OAuthConfigError를 던진다.
 *
 * 특히 redirect_uri는 화이트리스트와 "정확히 일치"해야 통과한다. (open redirect 방지)
 */
export function assertValidOAuthConfig(config: OAuthConfig): void {
  if (config.clientId.trim() === "") {
    throw new OAuthConfigError("clientId must not be empty");
  }
  if (config.scopes.length === 0) {
    throw new OAuthConfigError("scopes must include at least one scope");
  }
  if (config.scopes.some((scope) => scope.trim() === "")) {
    throw new OAuthConfigError("scopes must not contain empty values");
  }
  if (config.allowedRedirectUris.length === 0) {
    throw new OAuthConfigError("allowedRedirectUris must not be empty");
  }
  if (!config.allowedRedirectUris.includes(config.redirectUri)) {
    throw new OAuthConfigError(
      `redirectUri "${config.redirectUri}" is not in the allowed redirect URIs whitelist`,
    );
  }
}
