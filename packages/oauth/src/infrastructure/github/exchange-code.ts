import { assertValidOAuthConfig, type OAuthConfig } from "../../domain/oauth-config";
import {
  sanitizeProviderErrorCode,
  sanitizeProviderErrorDescription,
  type OAuthProviderError,
} from "../../domain/oauth-provider-error";

/** GitHub.com 기본 토큰 엔드포인트. */
export const DEFAULT_GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** 외부 호출 기본 타임아웃(ms). 초과 시 예외로 전파된다. */
export const DEFAULT_GITHUB_TIMEOUT_MS = 10_000;

export type ExchangeCodeInput = {
  readonly config: OAuthConfig;
  /** 콜백 처리에서 확보한 authorization code. */
  readonly code: string;
  /** 테스트 주입용. 기본은 내장 fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
};

export type ExchangeCodeResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly providerError?: OAuthProviderError };

/**
 * authorization code를 GitHub access token으로 교환한다.
 *
 * GitHub은 잘못된 code에도 HTTP 200 + body의 error로 응답하므로,
 * 상태코드가 아니라 body의 access_token/error 유무로 판정한다.
 * 네트워크·타임아웃 예외(응답 자체가 안 옴)는 그대로 전파한다.
 */
export async function exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
  assertValidOAuthConfig(input.config);
  if (input.code.trim() === "") {
    throw new Error("code must not be empty");
  }

  const doFetch = input.fetch ?? globalThis.fetch;
  const response = await doFetch(DEFAULT_GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      code: input.code,
      redirect_uri: input.config.redirectUri,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS),
  });

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok || typeof body !== "object" || body === null) {
    return { ok: false };
  }

  const record = body as Record<string, unknown>;
  const accessToken = record["access_token"];
  if (typeof accessToken === "string" && accessToken !== "") {
    return { ok: true, accessToken };
  }

  const error = sanitizeProviderErrorCode(record["error"]);
  const errorDescription = sanitizeProviderErrorDescription(record["error_description"]);
  return {
    ok: false,
    ...(error !== undefined
      ? {
          providerError: {
            error,
            ...(errorDescription !== undefined ? { errorDescription } : {}),
          },
        }
      : {}),
  };
}
