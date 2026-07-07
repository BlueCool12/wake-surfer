import type { OAuthConfig } from "../domain/oauth-config";
import { issueState as defaultIssueState } from "../domain/state";
import { createAuthorizeUrl } from "../github/authorize-url";
import type { StateStorePort } from "../runtime-deps";

export interface StartGithubLoginInput {
  readonly config: OAuthConfig;
  readonly stateStore: StateStorePort;
  /** state 생성기 주입 지점. 기본은 도메인의 `issueState`. 테스트에서 결정론적 값을 넣을 때 쓴다. */
  readonly issueState?: () => string;
}

export interface StartGithubLoginResult {
  /** 사용자를 302 리다이렉트할 GitHub authorize URL. */
  readonly authorizeUrl: string;
  /** 이번에 발급·저장된 state. (콜백에서 대조할 값) */
  readonly state: string;
}

/**
 * ★ 이슈 #5의 로그인 진입점 유스케이스.
 *
 * 흐름: state 발급 → authorize URL 조립(설정 검증 포함) → state 저장 → 결과 반환.
 * 앱은 반환된 `authorizeUrl`로 302 리다이렉트하면 된다.
 *
 * URL 조립이 config(redirect_uri 화이트리스트)를 먼저 검증하므로, 설정이 잘못되면
 * **state를 저장하기 전에** 예외를 던진다. (쓰지도 않을 state 쿠키를 남기지 않는다)
 */
export async function startGithubLogin(
  input: StartGithubLoginInput,
): Promise<StartGithubLoginResult> {
  const state = (input.issueState ?? defaultIssueState)();
  const authorizeUrl = createAuthorizeUrl(input.config, state);
  await input.stateStore.save(state);
  return { authorizeUrl, state };
}
