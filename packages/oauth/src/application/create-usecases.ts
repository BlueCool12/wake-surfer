import type { OAuthConfig } from "../domain/oauth-config";
import type { StateStorePort } from "../runtime-deps";
import {
  startGithubLogin,
  type StartGithubLoginResult,
} from "./start-github-login.usecase";

export interface OAuthUsecases {
  /** 요청마다 바인딩된 StateStore를 받아 로그인 진입점을 실행한다. */
  startGithubLogin(stateStore: StateStorePort): Promise<StartGithubLoginResult>;
}

/**
 * 앱-정적 `OAuthConfig`를 묶어 유스케이스 묶음을 만드는 팩토리.
 *
 * config(client_id·redirect_uri 화이트리스트 등)는 앱 부팅 시 한 번 주입하고,
 * 요청마다 달라지는 `StateStore`(쿠키가 req/res에 바인딩됨)는 호출 시점에 넘긴다.
 */
export function createOAuthUsecases(config: OAuthConfig): OAuthUsecases {
  return {
    startGithubLogin: (stateStore) => startGithubLogin({ config, stateStore }),
  };
}
