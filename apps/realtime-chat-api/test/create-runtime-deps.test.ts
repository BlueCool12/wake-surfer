import type { RealtimeChatDatabaseHandle } from "@wake-surfer/realtime-chat-database";
import { describe, expect, it, vi } from "vitest";

import { createRuntimeDeps } from "../src/runtime/create-runtime-deps.js";

describe("realtime chat API runtime dependencies", () => {
  it("validates runtime configuration before creating a database pool", async () => {
    const close = vi.fn(async () => undefined);
    const database = createDatabaseHandle(close);
    const createDatabase = vi.fn(() => database);

    await expect(
      createRuntimeDeps(
        {
          ...requiredEnv(),
          REALTIME_CHAT_GATEWAY_URL: "https://gateway.example.com/realtime-chat",
        },
        {
          createDatabase,
        },
      ),
    ).rejects.toThrow(/URL/);
    expect(createDatabase).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("leaves schema migration outside the app startup and exposes database cleanup", async () => {
    const close = vi.fn(async () => undefined);
    const database = createDatabaseHandle(close);

    const runtime = await createRuntimeDeps(requiredEnv(), {
      createDatabase: () => database,
    });

    expect(close).not.toHaveBeenCalled();
    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
  });
});

function createDatabaseHandle(
  close: RealtimeChatDatabaseHandle["close"],
): RealtimeChatDatabaseHandle {
  return {
    db: {} as RealtimeChatDatabaseHandle["db"],
    close,
  };
}

function requiredEnv(): NodeJS.ProcessEnv {
  return {
    REALTIME_CHAT_DATABASE_URL: "postgres://localhost/wake_surfer",
    REALTIME_CHAT_GATEWAY_API_TOKEN: "a".repeat(32),
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
    REALTIME_CHAT_GATEWAY_URL: "ws://localhost:3001/realtime-chat",
  };
}
