import { Controller, Inject, Post, Req, Res } from "@nestjs/common";
import type { OAuthUsecases } from "@wake-surfer/oauth";
import type { Request, Response } from "express";
import type { AuthApiConfig } from "../config/env";
import { AUTH_CONFIG, OAUTH_USECASES } from "./auth.tokens";
import { clearTokenCookies, readRefreshCookie, setTokenCookies } from "./token-cookies";

@Controller("auth")
export class SessionController {
  constructor(
    @Inject(OAUTH_USECASES) private readonly oauth: OAuthUsecases,
    @Inject(AUTH_CONFIG) private readonly config: AuthApiConfig,
  ) {}

  private acceptsOrigin(request: Request, response: Response): boolean {
    response.setHeader("Cache-Control", "no-store");
    if (request.get("origin") !== new URL(this.config.webOrigin).origin) {
      response.status(403).json({ code: "INVALID_ORIGIN" });
      return false;
    }
    return true;
  }

  @Post("refresh")
  async refresh(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.acceptsOrigin(request, response)) return;
    const result = await this.oauth.refreshAuthTokens(readRefreshCookie(request));
    if (result.status === "rejected") {
      // 늦게 도착한 실패 응답이 다른 요청의 새 쿠키를 지우면 안 된다.
      response.status(401).json({ code: result.reason });
      return;
    }
    setTokenCookies(response, result.tokens, this.config.cookieSecure);
    response.status(204).end();
  }

  @Post("logout")
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.acceptsOrigin(request, response)) return;
    await this.oauth.logout(readRefreshCookie(request));
    clearTokenCookies(response, this.config.cookieSecure);
    response.status(204).end();
  }
}
