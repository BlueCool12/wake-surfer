import { describe, expect, it } from "vitest";

import type { CookieAttributes, CookieJar } from "../src/infrastructure/cookie/cookie-state-store";
import { createCookieStateStore } from "../src/infrastructure/cookie/cookie-state-store";

const SECRET = "test-secret-key";
const COOKIE = "oauth_state";

/** state를 실제로 보관하는 인메모리 가짜 쿠키 저장소 + set 호출 기록. */
function createFakeCookieJar() {
  const store = new Map<string, string>();
  const sets: Array<{ name: string; value: string; attributes: CookieAttributes }> = [];
  const jar: CookieJar = {
    get: (name) => store.get(name),
    set: (name, value, attributes) => {
      sets.push({ name, value, attributes });
      if (attributes.maxAge === 0) store.delete(name);
      else store.set(name, value);
    },
  };
  return { jar, sets, store };
}

describe("createCookieStateStore", () => {
  it("save→verify 왕복이 일치하면 true", () => {
    const { jar } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    stateStore.save("state-xyz");
    expect(stateStore.verify("state-xyz")).toBe(true);
  });

  it("verify는 성공 후 state를 소비한다 (두 번째 verify는 false)", () => {
    const { jar } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    stateStore.save("state-xyz");
    expect(stateStore.verify("state-xyz")).toBe(true);
    expect(stateStore.verify("state-xyz")).toBe(false); // 재사용 차단
  });

  it("돌아온 state가 다르면 false", () => {
    const { jar } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    stateStore.save("state-xyz");
    expect(stateStore.verify("state-OTHER")).toBe(false);
  });

  it("저장된 쿠키가 없으면 false", () => {
    const { jar } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    expect(stateStore.verify("anything")).toBe(false);
  });

  it("쿠키 값이 위조되면 서명 검증에서 false", () => {
    const { jar, store } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    stateStore.save("state-xyz");
    store.set(COOKIE, "state-xyz.forged-signature"); // 서명 훼손
    expect(stateStore.verify("state-xyz")).toBe(false);
  });

  it("verify는 실패해도 쿠키를 소비한다", () => {
    const { jar, store } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    stateStore.save("state-xyz");
    stateStore.verify("wrong"); // 실패
    expect(store.has(COOKIE)).toBe(false);
  });

  it("save는 보안 속성을 설정한다 (httpOnly/secure/sameSite/maxAge)", () => {
    const { jar, sets } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    stateStore.save("state-xyz");
    const lastSet = sets.at(-1)!;
    expect(lastSet.attributes.httpOnly).toBe(true);
    expect(lastSet.attributes.secure).toBe(true);
    expect(lastSet.attributes.sameSite).toBe("Lax");
    expect(lastSet.attributes.maxAge).toBeGreaterThan(0);
  });

  it("secret이 비어 있으면 생성 시 예외", () => {
    const { jar } = createFakeCookieJar();
    expect(() => createCookieStateStore({ cookies: jar, secret: "  " })).toThrow(/secret/);
  });

  it("다른 secret으로 검증하면 false (키 불일치 = 서명 위조)", () => {
    const { jar } = createFakeCookieJar();
    const stateStore = createCookieStateStore({ cookies: jar, secret: SECRET });
    stateStore.save("state-xyz");
    const wrongKeyStore = createCookieStateStore({ cookies: jar, secret: "different-secret" });
    expect(wrongKeyStore.verify("state-xyz")).toBe(false);
  });
});
