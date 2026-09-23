import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import { createCookieStateStore, type OAuthUsecases } from "@wake-surfer/oauth";
import type { Request, Response } from "express";

import { createExpressCookieJar } from "../adapters/express-cookie-jar";
import type { AuthApiConfig } from "../config/env";
import { AUTH_CONFIG, OAUTH_USECASES } from "./auth.tokens";
import { isSuspicious, loginFailureRedirect, type RejectionReason } from "./login-result.mapper";

import { setTokenCookies } from "./token-cookies";

@Controller("auth/github")
export class AuthController {
  constructor(
    @Inject(OAUTH_USECASES) private readonly oauth: OAuthUsecases,
    @Inject(AUTH_CONFIG) private readonly config: AuthApiConfig,
  ) {}

  @Get("login")
  async login(@Req() request: Request, @Res() response: Response): Promise<void> {
    const { authorizeUrl } = await this.oauth.startGithubLogin(
      this.stateStoreFor(request, response),
    );
    response.redirect(302, authorizeUrl);
  }

  @Get("callback")
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const stateStore = this.stateStoreFor(request, response);

    const callback = await this.oauth.handleGithubCallback(stateStore, query);
    if (callback.status === "rejected") {
      this.redirectFailure(response, callback.reason);
      return;
    }

    const result = await this.oauth.completeGithubLogin(callback.code);
    if (result.status === "rejected") {
      this.redirectFailure(response, result.reason);
      return;
    }

    setTokenCookies(response, result.tokens, this.config.cookieSecure);
    response.redirect(302, new URL("/rooms", this.config.webOrigin).toString());
  }

  private stateStoreFor(request: Request, response: Response) {
    return createCookieStateStore({
      cookies: createExpressCookieJar(request, response),
      secret: this.config.cookieSecret,
      secure: this.config.cookieSecure,
    });
  }

  private redirectFailure(response: Response, reason: RejectionReason): void {
    if (isSuspicious(reason)) {
      // CSRF 의심. 사용자에게는 만료로 안내하고 서버 로그에만 남긴다.
      console.warn(`[auth] suspicious callback rejected: ${reason}`);
    }
    response.redirect(302, loginFailureRedirect(this.config.webOrigin, reason));
  }
}
