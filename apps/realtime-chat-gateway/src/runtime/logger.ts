import pino from "pino";

export type AppLogger = {
  error: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export function createLogger(level: string): AppLogger {
  return pino({
    level,
    name: "realtime-chat-gateway",
  });
}
