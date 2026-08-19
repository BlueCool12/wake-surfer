import type { CookieJar, SameSite } from "@wake-surfer/oauth";
import type { Request, Response } from "express";

/** oauth 패키지는 "Lax", express는 "lax"를 쓴다. */
function toExpressSameSite(sameSite: SameSite): "lax" | "strict" | "none" {
  switch (sameSite) {
    case "Strict":
      return "strict";
    case "None":
      return "none";
    default:
      return "lax";
  }
}

/**
 * Express 요청/응답을 oauth 패키지의 CookieJar 약속에 맞추는 어댑터.
 *
 * state 쿠키는 그 요청의 req/res에 묶이므로 **요청마다** 새로 만든다.
 * (부팅 시 한 번 만들 수 있는 config·클라이언트와 수명이 다르다.)
 */
export function createExpressCookieJar(request: Request, response: Response): CookieJar {
  return {
    get: (name) => {
      const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[name];
      return typeof value === "string" ? value : undefined;
    },

    set: (name, value, attrs) => {
      response.cookie(name, value, {
        httpOnly: attrs.httpOnly,
        secure: attrs.secure,
        sameSite: toExpressSameSite(attrs.sameSite),
        path: attrs.path,
        maxAge: attrs.maxAge * 1000, // oauth는 초, express는 밀리초
      });
    },
  };
}
