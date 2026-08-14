import { OAuthConfigError, type OAuthConfig } from "../domain/oauth-config";
import {
  createGithubOAuthClient,
  type GithubOAuthClientOptions,
} from "../infrastructure/github/client";
import type { JwtSignerPort, OAuthCsrfStateStorePort, UserStorePort } from "../runtime-deps";
import {
  completeGithubLogin,
  type CompleteGithubLoginResult,
} from "./complete-github-login.usecase";
import {
  fetchGithubUserByCode,
  type FetchGithubUserByCodeResult,
} from "./fetch-github-user-by-code.usecase";
import {
  handleGithubCallback,
  type HandleGithubCallbackResult,
} from "./handle-github-callback.usecase";
import { startGithubLogin, type StartGithubLoginResult } from "./start-github-login.usecase";

export type OAuthUsecases = {
  /** 요청마다 바인딩된 StateStore를 받아 로그인 진입점을 실행한다. */
  startGithubLogin: (stateStore: OAuthCsrfStateStorePort) => Promise<StartGithubLoginResult>;
  /** GitHub 콜백 쿼리를 받아 state 검증·에러 분기를 수행한다. */
  handleGithubCallback: (
    stateStore: OAuthCsrfStateStorePort,
    query: Readonly<Record<string, unknown>>,
  ) => Promise<HandleGithubCallbackResult>;
  /** 콜백에서 확보한 code로 GitHub 사용자 정보(id·login·email)를 가져온다. */
  fetchGithubUserByCode: (code: string) => Promise<FetchGithubUserByCodeResult>;
  /** code로 로그인을 완성한다: 사용자 조회 → 회원 매핑 → JWT 발급. `auth` 옵션 필요. */
  completeGithubLogin: (code: string) => Promise<CompleteGithubLoginResult>;
};

/** completeGithubLogin에 필요한 의존성. 이 유스케이스를 쓸 때만 부팅 시 주입한다. */
export type OAuthAuthOptions = {
  readonly userStore: UserStorePort;
  readonly jwtSigner: JwtSignerPort;
  /** 현재 시각(epoch seconds). 기본은 실제 시계. */
  readonly clock?: () => number;
  /** access 토큰 수명(초). 기본 1800(30분). */
  readonly accessTtlSec?: number;
  /** refresh 토큰 수명(초). 기본 1209600(14일). */
  readonly refreshTtlSec?: number;
};

/** GitHub 통신 의존성(fetch·timeout) + 인증(auth). 부팅 시 한 번 주입한다. */
export type OAuthUsecasesOptions = GithubOAuthClientOptions & {
  readonly auth?: OAuthAuthOptions;
};

const DEFAULT_ACCESS_TTL_SEC = 1800; // 30분
const DEFAULT_REFRESH_TTL_SEC = 1_209_600; // 14일

/**
 * 앱-정적 `config`는 부팅 시 한 번 주입하고, 요청마다 달라지는 `StateStore`(req/res에
 * 바인딩된 쿠키)는 호출 시점에 넘긴다. — 이 수명 분리가 이 팩토리의 존재 이유.
 *
 * GitHub 통신 클라이언트와 인증 의존성(auth)도 부팅 시 한 번 조립해, 각 호출은 code만 넘긴다.
 */
export function createOAuthUsecases(
  config: OAuthConfig,
  options: OAuthUsecasesOptions = {},
): OAuthUsecases {
  const githubClient = createGithubOAuthClient(config, options);
  const auth = options.auth;
  return {
    startGithubLogin: (stateStore) => startGithubLogin({ config, stateStore }),
    handleGithubCallback: (stateStore, query) => handleGithubCallback({ query, stateStore }),
    fetchGithubUserByCode: (code) => fetchGithubUserByCode({ client: githubClient, code }),
    completeGithubLogin: async (code) => {
      if (auth === undefined) {
        throw new OAuthConfigError(
          "completeGithubLogin requires `auth` (userStore·jwtSigner) in createOAuthUsecases options",
        );
      }
      return completeGithubLogin({
        client: githubClient,
        userStore: auth.userStore,
        signer: auth.jwtSigner,
        accessTtlSec: auth.accessTtlSec ?? DEFAULT_ACCESS_TTL_SEC,
        refreshTtlSec: auth.refreshTtlSec ?? DEFAULT_REFRESH_TTL_SEC,
        ...(auth.clock !== undefined ? { now: auth.clock } : {}),
        code,
      });
    },
  };
}
