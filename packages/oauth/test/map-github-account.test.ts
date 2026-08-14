import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../src/domain/auth-user";
import { mapGithubAccount } from "../src/application/map-github-account.usecase";
import type { GithubUser } from "../src/infrastructure/github/user-client";
import type { UserStorePort } from "../src/runtime-deps";

const githubUser: GithubUser = { id: 12345, login: "octocat", email: "octo@example.com" };

/** 조회/생성 호출을 기록하는 가짜 UserStore. */
function fakeStore(existing?: AuthenticatedUser) {
  const lookups: Array<{ provider: string; providerUserId: string }> = [];
  const created: Array<{ provider: string; providerUserId: string; email: string; login: string }> =
    [];
  const store: UserStorePort = {
    findByProvider: (provider, providerUserId) => {
      lookups.push({ provider, providerUserId });
      return existing;
    },
    create: (input) => {
      created.push(input);
      return { id: "new-user-1" };
    },
  };
  return { store, lookups, created };
}

describe("mapGithubAccount", () => {
  it("(github, providerUserId)로 조회한다 — id는 문자열로 변환", async () => {
    const { store, lookups } = fakeStore();
    await mapGithubAccount({ githubUser, userStore: store });
    expect(lookups).toEqual([{ provider: "github", providerUserId: "12345" }]);
  });

  it("기존 회원이 있으면 재사용하고 create를 부르지 않는다", async () => {
    const { store, created } = fakeStore({ id: "existing-42" });
    const user = await mapGithubAccount({ githubUser, userStore: store });
    expect(user).toEqual({ id: "existing-42" });
    expect(created).toEqual([]);
  });

  it("없으면 provider·providerUserId·email·login으로 생성한다", async () => {
    const { store, created } = fakeStore();
    const user = await mapGithubAccount({ githubUser, userStore: store });
    expect(created).toEqual([
      { provider: "github", providerUserId: "12345", email: "octo@example.com", login: "octocat" },
    ]);
    expect(user).toEqual({ id: "new-user-1" });
  });
});
