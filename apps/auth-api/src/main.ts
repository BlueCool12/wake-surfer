import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import pino from "pino";

import { AppModule } from "./app.module";
import { AUTH_CONFIG } from "./auth/auth.tokens";
import type { AuthApiConfig } from "./config/env";
import { loadAuthApiConfig } from "./config/env";

async function bootstrap(): Promise<void> {
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

  // 라우트를 세우기 전에 설정을 먼저 검증한다. 누락이 있으면 여기서 끝낸다.
  loadAuthApiConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());

  const config = app.get<AuthApiConfig>(AUTH_CONFIG);
  await app.listen(config.port);
  logger.info({ port: config.port }, "auth-api listening");
}

void bootstrap().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[auth-api] 부팅 실패\n${detail}\n`);
  process.exitCode = 1;
});
