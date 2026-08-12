import type { AuthTokens } from "../domain/auth-token";
import type { AuthenticatedUser } from "../domain/auth-user";
import type { OAuthProviderError } from "../domain/oauth-provider-error";
import type { GithubOAuthClient } from "../infrastructure/github/client";
import type { JwtSignerPort, UserStorePort } from "../runtime-deps";

import { fetchGithubUserByCode } from "./fetch-github-user-by-code.usecase";
import { issueAuthTokens } from "./issue-auth-tokens.usecase";
import { mapGithubAccount } from "./map-github-account.usecase";

export type CompleteGithubLoginInput = {
  readonly client: GithubOAuthClient;
  readonly userStore: UserStorePort;
  readonly signer: JwtSignerPort;
  readonly accessTtlSec: number;
  readonly refreshTtlSec: number;
  readonly now?: () => number;
  /** 콜백 처리에서 확보한 authorization code. */
  readonly code: string;
};

export type CompleteGithubLoginResult =
  | { readonly status: "ok"; readonly user: AuthenticatedUser; readonly tokens: AuthTokens }
  | {
      readonly status: "rejected";
      readonly reason: "TOKEN_EXCHANGE_FAILED" | "USER_FETCH_FAILED" | "EMAIL_UNAVAILABLE";
      readonly providerError?: OAuthProviderError;
    };

/**
 * 로그인 완성 파사드: code → GitHub 사용자 조회 → 회원 매핑 → JWT 발급.
 *
 * GitHub 통신 실패는 `fetchGithubUserByCode`의 reason을 그대로 전파한다.
 * 매핑·발급 단계의 인프라 오류(DB·서명)는 예외로 전파한다.
 */
export async function completeGithubLogin(
  input: CompleteGithubLoginInput,
): Promise<CompleteGithubLoginResult> {
  const fetched = await fetchGithubUserByCode({ client: input.client, code: input.code });
  if (fetched.status === "rejected") {
    return {
      status: "rejected",
      reason: fetched.reason,
      ...(fetched.providerError !== undefined ? { providerError: fetched.providerError } : {}),
    };
  }

  const user = await mapGithubAccount({ githubUser: fetched.user, userStore: input.userStore });
  const tokens = await issueAuthTokens({
    user,
    signer: input.signer,
    accessTtlSec: input.accessTtlSec,
    refreshTtlSec: input.refreshTtlSec,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });

  return { status: "ok", user, tokens };
}
