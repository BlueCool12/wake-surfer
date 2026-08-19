import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import { createCookieStateStore, type OAuthUsecases } from "@wake-surfer/oauth";
import type { Request, Response } from "express";

import { createExpressCookieJar } from "../adapters/express-cookie-jar";
import type { AuthApiConfig } from "../config/env";
import { AUTH_CONFIG, OAUTH_USECASES } from "./auth.tokens";
import { isSuspicious, loginFailureRedirect, type RejectionReason } from "./login-result.mapper";

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const ACCESS_MAX_AGE_SEC = 1800; // 30분 — 라이브러리 기본값과 맞춤
const REFRESH_MAX_AGE_SEC = 1_209_600; // 14일
/** refresh는 재발급 경로에만 실리도록 좁힌다. */
const REFRESH_COOKIE_PATH = "/auth";

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

    this.setTokenCookies(response, result.tokens.accessToken, result.tokens.refreshToken);
    response.redirect(302, this.config.webOrigin);
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

  private setTokenCookies(response: Response, accessToken: string, refreshToken: string): void {
    const base = {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: "lax",
    } as const;

    response.cookie(ACCESS_COOKIE, accessToken, {
      ...base,
      path: "/",
      maxAge: ACCESS_MAX_AGE_SEC * 1000,
    });
    response.cookie(REFRESH_COOKIE, refreshToken, {
      ...base,
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_MAX_AGE_SEC * 1000,
    });
  }
}
