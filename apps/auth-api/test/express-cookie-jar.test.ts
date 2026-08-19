import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import { createExpressCookieJar } from "../src/adapters/express-cookie-jar";

function fakePair(cookies: Record<string, unknown> = {}) {
  const set = vi.fn();
  const request = { cookies } as unknown as Request;
  const response = { cookie: set } as unknown as Response;
  return { jar: createExpressCookieJar(request, response), set };
}

describe("createExpressCookieJar", () => {
  it("요청 쿠키에서 문자열 값을 읽는다", () => {
    const { jar } = fakePair({ oauth_state: "signed-value" });

    expect(jar.get("oauth_state")).toBe("signed-value");
  });

  it("없거나 문자열이 아닌 값은 undefined로 취급한다", () => {
    const { jar } = fakePair({ oauth_state: ["a", "b"] });

    expect(jar.get("oauth_state")).toBeUndefined();
    expect(jar.get("absent")).toBeUndefined();
  });

  it("cookie-parser가 없어도 터지지 않는다", () => {
    const request = {} as unknown as Request;
    const response = { cookie: vi.fn() } as unknown as Response;

    expect(createExpressCookieJar(request, response).get("oauth_state")).toBeUndefined();
  });

  it("maxAge를 초에서 밀리초로 바꾼다", () => {
    const { jar, set } = fakePair();

    jar.set("oauth_state", "v", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });

    expect(set).toHaveBeenCalledWith(
      "oauth_state",
      "v",
      expect.objectContaining({ maxAge: 600_000 }),
    );
  });

  it("sameSite를 express가 쓰는 소문자로 바꾼다", () => {
    const { jar, set } = fakePair();
    const attrs = { httpOnly: true, secure: true, path: "/", maxAge: 0 } as const;

    jar.set("a", "v", { ...attrs, sameSite: "Lax" });
    jar.set("b", "v", { ...attrs, sameSite: "Strict" });
    jar.set("c", "v", { ...attrs, sameSite: "None" });

    expect(set.mock.calls.map((call) => (call[2] as { sameSite: string }).sameSite)).toEqual([
      "lax",
      "strict",
      "none",
    ]);
  });
});
