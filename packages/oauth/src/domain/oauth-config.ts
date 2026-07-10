export type OAuthConfig = {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  /**
   * authorize 엔드포인트 오버라이드.
   * 테스트나 GitHub Enterprise 대응용. 미지정 시 github.com을 사용한다.
   */
  readonly authorizeBaseUrl?: string;
};

/** 설정값이 유효하지 않을 때 던지는 도메인 에러. */
export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigError";
  }
}

/** OAuthConfig가 유효한지 검증한다. 위반 시 OAuthConfigError를 던진다. */
export function assertValidOAuthConfig(config: OAuthConfig): void {
  if (config.clientId.trim() === "") {
    throw new OAuthConfigError("clientId must not be empty");
  }
  if (config.redirectUri.trim() === "") {
    throw new OAuthConfigError("redirectUri must not be empty");
  }
  if (config.scopes.length === 0) {
    throw new OAuthConfigError("scopes must include at least one scope");
  }
  if (config.scopes.some((scope) => scope.trim() === "")) {
    throw new OAuthConfigError("scopes must not contain empty values");
  }
}
