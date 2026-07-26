import type { OAuthConfig } from "../domain/oauth-config";
import type { OAuthProviderError } from "../domain/oauth-provider-error";
import { exchangeCode } from "../infrastructure/github/exchange-code";
import { fetchGithubUser, type GithubUser } from "../infrastructure/github/fetch-github-user";

export type FetchGithubUserByCodeInput = {
  readonly config: OAuthConfig;
  /** 콜백 처리에서 확보한 authorization code. */
  readonly code: string;
  /** 테스트 주입용. 기본은 내장 fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
};

export type FetchGithubUserByCodeResult =
  | { readonly status: "ok"; readonly user: GithubUser }
  | {
      readonly status: "rejected";
      readonly reason: "TOKEN_EXCHANGE_FAILED" | "USER_FETCH_FAILED" | "EMAIL_UNAVAILABLE";
      readonly providerError?: OAuthProviderError;
    };

/**
 * GitHub 통신 유스케이스: code → access token 교환 → 사용자 정보 조회.
 *
 * access token은 사용자 조회에만 쓰고 결과로 노출하지 않는다.
 * 예상 가능한 실패는 결과 유니언으로 반환하고, 네트워크·타임아웃 예외는 그대로 전파한다.
 */
export async function fetchGithubUserByCode(
  input: FetchGithubUserByCodeInput,
): Promise<FetchGithubUserByCodeResult> {
  const common = {
    ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  };

  const exchanged = await exchangeCode({ config: input.config, code: input.code, ...common });
  if (!exchanged.ok) {
    return {
      status: "rejected",
      reason: "TOKEN_EXCHANGE_FAILED",
      ...(exchanged.providerError !== undefined ? { providerError: exchanged.providerError } : {}),
    };
  }

  const fetched = await fetchGithubUser({ accessToken: exchanged.accessToken, ...common });
  if (!fetched.ok) {
    return { status: "rejected", reason: fetched.reason };
  }

  return { status: "ok", user: fetched.user };
}
