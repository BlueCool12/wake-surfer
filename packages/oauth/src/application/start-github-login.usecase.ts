import type { OAuthConfig } from "../domain/oauth-config";
import { issueOAuthCsrfState as defaultIssueState } from "../domain/oauth-csrf-state";
import { createAuthorizeUrl } from "../infrastructure/github/authorize-url";
import type { OAuthCsrfStateStorePort } from "../runtime-deps";

export type StartGithubLoginInput = {
  readonly config: OAuthConfig;
  readonly stateStore: OAuthCsrfStateStorePort;
  /** state 생성기 주입 지점(테스트에서 결정론적 값 주입용). 기본은 `issueOAuthCsrfState`. */
  readonly issueState?: () => string;
};

export type StartGithubLoginResult = {
  /** 사용자를 302 리다이렉트할 GitHub authorize URL. */
  readonly authorizeUrl: string;
  /** 이번에 발급·저장된 state. (콜백에서 대조할 값) */
  readonly state: string;
};

/**
 * 로그인 진입점 유스케이스.
 *
 * config 검증(authorize URL 조립 단계)이 state 저장보다 먼저이므로,
 * 설정이 잘못되면 state를 저장하기 전에 예외를 던진다. (고아 state 쿠키 방지)
 */
export async function startGithubLogin(
  input: StartGithubLoginInput,
): Promise<StartGithubLoginResult> {
  const state = (input.issueState ?? defaultIssueState)();
  const authorizeUrl = createAuthorizeUrl(input.config, state);
  await input.stateStore.save(state);
  return { authorizeUrl, state };
}
