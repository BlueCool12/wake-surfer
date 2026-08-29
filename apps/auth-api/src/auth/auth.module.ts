import { Module } from "@nestjs/common";
import { createOAuthUsecases, type JwtSignerPort, type UserStorePort } from "@wake-surfer/oauth";

import { createPrismaUserStore } from "../adapters/prisma-user-store";
import { createRs256JwtSigner } from "../adapters/rs256-jwt-signer";
import { loadAuthApiConfig, type AuthApiConfig } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AuthController } from "./auth.controller";
import { AUTH_CONFIG, JWT_SIGNER, OAUTH_USECASES, USER_STORE } from "./auth.tokens";

/**
 * 앱-정적 의존성(config·GitHub 클라이언트·DB·서명기)은 부팅 시 한 번 조립한다.
 * 요청마다 달라지는 stateStore만 컨트롤러가 요청 시점에 만든다.
 */
@Module({
  controllers: [AuthController],
  providers: [
    PrismaService,
    {
      provide: AUTH_CONFIG,
      useFactory: (): AuthApiConfig => loadAuthApiConfig(),
    },
    {
      provide: USER_STORE,
      useFactory: (prisma: PrismaService): UserStorePort => createPrismaUserStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: JWT_SIGNER,
      useFactory: (config: AuthApiConfig): JwtSignerPort =>
        createRs256JwtSigner(config.jwtPrivateKey),
      inject: [AUTH_CONFIG],
    },
    {
      provide: OAUTH_USECASES,
      useFactory: (config: AuthApiConfig, userStore: UserStorePort, jwtSigner: JwtSignerPort) =>
        createOAuthUsecases(
          {
            clientId: config.githubClientId,
            clientSecret: config.githubClientSecret,
            redirectUri: config.githubRedirectUri,
            scopes: [...config.githubScopes],
          },
          { auth: { userStore, jwtSigner } },
        ),
      inject: [AUTH_CONFIG, USER_STORE, JWT_SIGNER],
    },
  ],
  exports: [AUTH_CONFIG],
})
export class AuthModule {}
