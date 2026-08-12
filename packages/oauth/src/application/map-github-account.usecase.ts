import type { AuthenticatedUser } from "../domain/auth-user";
import type { GithubUser } from "../infrastructure/github/user-client";
import type { UserStorePort } from "../runtime-deps";

export type MapGithubAccountInput = {
  readonly githubUser: GithubUser;
  readonly userStore: UserStorePort;
};

/** 매핑 키의 provider 값. 현재 로그인 수단은 GitHub 하나뿐이다. */
const GITHUB_PROVIDER = "github";

/**
 * GitHub 사용자를 우리 회원으로 매핑한다.
 *
 * `(provider, providerUserId)`로 조회해 있으면 재사용(재로그인), 없으면 생성한다(최초 로그인).
 * 지금은 예상 가능한 비즈니스 실패가 없어(이메일 충돌 없음) 회원을 직접 반환한다.
 * DB 장애 같은 인프라 오류는 예외로 전파한다.
 */
export async function mapGithubAccount(input: MapGithubAccountInput): Promise<AuthenticatedUser> {
  const providerUserId = String(input.githubUser.id);

  const existing = await input.userStore.findByProvider(GITHUB_PROVIDER, providerUserId);
  if (existing !== undefined) {
    return existing;
  }

  return input.userStore.create({
    provider: GITHUB_PROVIDER,
    providerUserId,
    email: input.githubUser.email,
    login: input.githubUser.login,
  });
}
