import pino from "pino";

import type { AppLogger } from "../app.js";

export function createLogger(level: string): AppLogger {
  return pino({
    level,
    name: "realtime-chat-api",
  });
}
