import { describe, expect, it } from "vitest";

import { createOAuthUsecases } from "../src/application/create-usecases";
import { startGithubLogin } from "../src/application/start-github-login.usecase";
import type { OAuthConfig } from "../src/domain/oauth-config";
import type { OAuthCsrfStateStorePort } from "../src/runtime-deps";

const config: OAuthConfig = {
  clientId: "client-123",
  redirectUri: "https://app.example.com/auth/github/callback",
  scopes: ["user:email"],
};

/** 저장된 state를 기록하는 가짜 StateStore. */
function fakeStore() {
  const saved: string[] = [];
  const store: OAuthCsrfStateStorePort = {
    save: (state) => {
      saved.push(state);
    },
    verify: () => true,
  };
  return { store, saved };
}

describe("startGithubLogin", () => {
  it("state를 발급해 저장하고, 그 state가 담긴 authorize URL을 돌려준다", async () => {
    const { store, saved } = fakeStore();
    const result = await startGithubLogin({
      config,
      stateStore: store,
      issueState: () => "fixed-state",
    });

    expect(saved).toEqual(["fixed-state"]);
    expect(result.state).toBe("fixed-state");
    const url = new URL(result.authorizeUrl);
    expect(url.searchParams.get("state")).toBe("fixed-state");
    expect(url.searchParams.get("client_id")).toBe("client-123");
  });

  it("기본 state 생성기는 매 호출 다른 값을 만든다", async () => {
    const { store } = fakeStore();
    const a = await startGithubLogin({ config, stateStore: store });
    const b = await startGithubLogin({ config, stateStore: store });
    expect(a.state).not.toBe(b.state);
  });

  it("config가 유효하지 않으면 던지고, state를 저장하지 않는다 (고아 쿠키 방지)", async () => {
    const { store, saved } = fakeStore();
    const badConfig = { ...config, redirectUri: "  " };
    await expect(
      startGithubLogin({ config: badConfig, stateStore: store, issueState: () => "s" }),
    ).rejects.toThrow(/redirectUri/);
    expect(saved).toEqual([]);
  });
});

describe("createOAuthUsecases", () => {
  it("정적 config를 묶고, 호출 시 StateStore를 받아 동작한다", async () => {
    const usecases = createOAuthUsecases(config);
    const { store, saved } = fakeStore();
    const result = await usecases.startGithubLogin(store);
    expect(saved).toHaveLength(1);
    expect(new URL(result.authorizeUrl).searchParams.get("state")).toBe(result.state);
  });
});
