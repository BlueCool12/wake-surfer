import pino from "pino";

export type AppLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export function createLogger(level: string): AppLogger {
  return pino({
    level,
    name: "realtime-media-gateway",
  });
}

/** 오류를 로그 컨텍스트에 담을 수 있는 평범한 객체로 바꾼다. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }

  return { value: String(error) };
}
