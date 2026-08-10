import type { OAuthProviderError } from "../domain/oauth-provider-error";
import type { GithubOAuthClient } from "../infrastructure/github/client";
import type { GithubUser } from "../infrastructure/github/user-client";

export type FetchGithubUserByCodeInput = {
  readonly client: GithubOAuthClient;
  /** 콜백 처리에서 확보한 authorization code. */
  readonly code: string;
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
 * access token은 클라이언트 내부에서만 쓰이고 결과로 노출되지 않는다.
 * 예상 가능한 실패는 결과 유니언으로 반환하고, 네트워크·타임아웃 예외는 그대로 전파한다.
 */
export async function fetchGithubUserByCode(
  input: FetchGithubUserByCodeInput,
): Promise<FetchGithubUserByCodeResult> {
  const exchanged = await input.client.exchangeCode(input.code);
  if (!exchanged.ok) {
    return {
      status: "rejected",
      reason: "TOKEN_EXCHANGE_FAILED",
      ...(exchanged.providerError !== undefined ? { providerError: exchanged.providerError } : {}),
    };
  }

  const fetched = await input.client.fetchUser(exchanged.accessToken);
  if (!fetched.ok) {
    return { status: "rejected", reason: fetched.reason };
  }

  return { status: "ok", user: fetched.user };
}
