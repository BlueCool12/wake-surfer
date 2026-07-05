import pino, { type Logger } from "pino";
import type { LoggerPort } from "@wake-surfer/realtime-chat/gateway";
import type { AppEnv } from "../config/env";

export function createLogger(env: AppEnv): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: "@wake-surfer/realtime-chat-gateway",
    },
  });
}

export function toLoggerPort(logger: Logger): LoggerPort {
  return {
    info(message, fields) {
      logger.info(fields ?? {}, message);
    },
    warn(message, fields) {
      logger.warn(fields ?? {}, message);
    },
    error(message, fields) {
      logger.error(fields ?? {}, message);
    },
  };
}
