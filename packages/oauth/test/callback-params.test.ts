import { describe, expect, it } from "vitest";

import { parseGithubCallbackParams } from "../src/infrastructure/github/callback-params";

describe("parseGithubCallbackParams", () => {
  it("문자열 파라미터를 추출한다 (error_description은 camelCase로)", () => {
    expect(
      parseGithubCallbackParams({
        code: "code-1",
        state: "state-1",
        error: "access_denied",
        error_description: "The user has denied your application access.",
      }),
    ).toEqual({
      code: "code-1",
      state: "state-1",
      error: "access_denied",
      errorDescription: "The user has denied your application access.",
    });
  });

  it("없는 키는 결과에 포함하지 않는다", () => {
    expect(parseGithubCallbackParams({ code: "code-1" })).toEqual({ code: "code-1" });
    expect(parseGithubCallbackParams({})).toEqual({});
  });

  it("중복 파라미터(배열)는 없는 것으로 취급한다 (parameter pollution 방어)", () => {
    expect(parseGithubCallbackParams({ state: ["a", "b"], code: "code-1" })).toEqual({
      code: "code-1",
    });
  });

  it("비문자열/빈 문자열 값은 없는 것으로 취급한다", () => {
    expect(
      parseGithubCallbackParams({ code: 123, state: "", error: null, error_description: {} }),
    ).toEqual({});
  });

  it("관심 없는 쿼리 키는 무시한다", () => {
    expect(parseGithubCallbackParams({ state: "s", utm_source: "x" })).toEqual({ state: "s" });
  });
});
