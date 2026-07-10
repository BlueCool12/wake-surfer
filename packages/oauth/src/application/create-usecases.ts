import type { OAuthConfig } from "../domain/oauth-config";
import type { OAuthCsrfStateStorePort } from "../runtime-deps";
import { startGithubLogin, type StartGithubLoginResult } from "./start-github-login.usecase";

export type OAuthUsecases = {
  /** 요청마다 바인딩된 StateStore를 받아 로그인 진입점을 실행한다. */
  startGithubLogin: (stateStore: OAuthCsrfStateStorePort) => Promise<StartGithubLoginResult>;
};

/**
 * 앱-정적 `config`는 부팅 시 한 번 주입하고, 요청마다 달라지는 `StateStore`(req/res에
 * 바인딩된 쿠키)는 호출 시점에 넘긴다. — 이 수명 분리가 이 팩토리의 존재 이유.
 */
export function createOAuthUsecases(config: OAuthConfig): OAuthUsecases {
  return {
    startGithubLogin: (stateStore) => startGithubLogin({ config, stateStore }),
  };
}
