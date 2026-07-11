import { describe, expect, it } from "vitest";

import { handleGithubCallback } from "../src/application/handle-github-callback.usecase";
import { createCookieStateStore, type CookieAttributes, type CookieJar } from "../src/index";
import type { OAuthCsrfStateStorePort } from "../src/runtime-deps";

/** verify 호출을 기록하는 가짜 StateStore. */
function fakeStore(verifyResult: boolean) {
  const verifiedWith: string[] = [];
  const store: OAuthCsrfStateStorePort = {
    save: () => {},
    verify: (state) => {
      verifiedWith.push(state);
      return verifyResult;
    },
  };
  return { store, verifiedWith };
}

/** 실제 쿠키 구현으로 왕복을 검증할 때 쓰는 인메모리 CookieJar. */
function createFakeCookieJar() {
  const jar = new Map<string, string>();
  const cookies: CookieJar = {
    get: (name) => jar.get(name),
    set: (name, value, attributes: CookieAttributes) => {
      if (attributes.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  };
  return { cookies, jar };
}

describe("handleGithubCallback", () => {
  it("state 일치 + code 존재면 ok와 code를 반환한다", async () => {
    const { store } = fakeStore(true);
    const result = await handleGithubCallback({
      query: { code: "code-1", state: "state-1" },
      stateStore: store,
    });
    expect(result).toEqual({ status: "ok", code: "code-1" });
  });

  it("error=access_denied면 ACCESS_DENIED로 거부하고 원본을 보존한다", async () => {
    const { store } = fakeStore(true);
    const result = await handleGithubCallback({
      query: {
        error: "access_denied",
        error_description: "The user has denied your application access.",
        state: "state-1",
      },
      stateStore: store,
    });
    expect(result).toEqual({
      status: "rejected",
      reason: "ACCESS_DENIED",
      providerError: {
        error: "access_denied",
        errorDescription: "The user has denied your application access.",
      },
    });
  });

  it("그 외 error는 PROVIDER_ERROR로 거부한다", async () => {
    const { store } = fakeStore(true);
    const result = await handleGithubCallback({
      query: { error: "temporarily_unavailable" },
      stateStore: store,
    });
    expect(result).toEqual({
      status: "rejected",
      reason: "PROVIDER_ERROR",
      providerError: { error: "temporarily_unavailable" },
    });
  });

  it("error 분기에서도 state 쿠키를 소비한다 (state가 없어도)", async () => {
    const { store, verifiedWith } = fakeStore(true);
    await handleGithubCallback({ query: { error: "access_denied" }, stateStore: store });
    expect(verifiedWith).toEqual([""]); // 소비 목적 호출
  });

  it("state가 없으면 MISSING_STATE로 거부한다", async () => {
    const { store, verifiedWith } = fakeStore(true);
    const result = await handleGithubCallback({ query: { code: "code-1" }, stateStore: store });
    expect(result).toEqual({ status: "rejected", reason: "MISSING_STATE" });
    expect(verifiedWith).toEqual([]); // 검증 시도 자체가 없음
  });

  it("중복 state 파라미터(배열)는 MISSING_STATE로 거부한다", async () => {
    const { store } = fakeStore(true);
    const result = await handleGithubCallback({
      query: { code: "code-1", state: ["a", "b"] },
      stateStore: store,
    });
    expect(result).toEqual({ status: "rejected", reason: "MISSING_STATE" });
  });

  it("state가 저장값과 불일치하면 STATE_MISMATCH로 거부한다", async () => {
    const { store } = fakeStore(false);
    const result = await handleGithubCallback({
      query: { code: "code-1", state: "wrong" },
      stateStore: store,
    });
    expect(result).toEqual({ status: "rejected", reason: "STATE_MISMATCH" });
  });

  it("state는 통과했지만 code가 없으면 MISSING_CODE로 거부한다", async () => {
    const { store } = fakeStore(true);
    const result = await handleGithubCallback({ query: { state: "state-1" }, stateStore: store });
    expect(result).toEqual({ status: "rejected", reason: "MISSING_CODE" });
  });

  it("쿠키 구현과의 왕복: 같은 state는 한 번만 통과한다 (재사용 차단)", async () => {
    const { cookies } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies, secret: "test-secret" });
    stateStore.save("state-1");

    const first = await handleGithubCallback({
      query: { code: "code-1", state: "state-1" },
      stateStore,
    });
    expect(first).toEqual({ status: "ok", code: "code-1" });

    const second = await handleGithubCallback({
      query: { code: "code-2", state: "state-1" },
      stateStore,
    });
    expect(second).toEqual({ status: "rejected", reason: "STATE_MISMATCH" });
  });
});
