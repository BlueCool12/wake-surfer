import type { AuthTokens } from "@wake-surfer/oauth";
import type { Request, Response } from "express";

export const REFRESH_COOKIE = "refresh_token";
const paths = { access_token: "/", refresh_token: "/auth" } as const;
function options(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const };
}

export function readRefreshCookie(request: Request): string | undefined {
  const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === "string" ? value : undefined;
}
export function setTokenCookies(response: Response, tokens: AuthTokens, secure: boolean): void {
  const now = Date.now();
  response.setHeader("Cache-Control", "no-store");
  response.cookie("access_token", tokens.accessToken, {
    ...options(secure),
    path: paths.access_token,
    maxAge: Math.max(0, tokens.accessExpiresAt * 1000 - now),
  });
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...options(secure),
    path: paths.refresh_token,
    maxAge: Math.max(0, tokens.refreshExpiresAt * 1000 - now),
  });
}
export function clearTokenCookies(response: Response, secure: boolean): void {
  for (const [name, path] of Object.entries(paths))
    response.clearCookie(name, { ...options(secure), path });
}
