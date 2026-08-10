import type { OAuthConfig } from "../../domain/oauth-config";

import { createGithubRequestExecutor, type GithubRequestExecutorConfig } from "./request-executor";
import { createGithubTokenClient, type ExchangeCodeResult } from "./token-client";
import { createGithubUserClient, type FetchGithubUserResult } from "./user-client";

export type GithubOAuthClient = {
  exchangeCode: (code: string) => Promise<ExchangeCodeResult>;
  fetchUser: (accessToken: string) => Promise<FetchGithubUserResult>;
};

/** GitHub 통신 의존성. 미지정 시 내장 fetch와 기본 타임아웃을 쓴다. */
export type GithubOAuthClientOptions = GithubRequestExecutorConfig;

/**
 * fetch·timeout·엔드포인트를 한 번만 조립해 GitHub 통신 클라이언트를 만든다.
 * 각 호출은 code/token만 넘기고, 전송 의존성은 여기서 고정된다.
 */
export function createGithubOAuthClient(
  config: OAuthConfig,
  options: GithubOAuthClientOptions = {},
): GithubOAuthClient {
  const executor = createGithubRequestExecutor(options);
  const tokenClient = createGithubTokenClient(config, executor);
  const userClient = createGithubUserClient(executor);
  return {
    exchangeCode: tokenClient.exchangeCode,
    fetchUser: userClient.fetchUser,
  };
}
