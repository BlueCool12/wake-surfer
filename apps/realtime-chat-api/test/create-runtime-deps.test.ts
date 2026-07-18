import type { RealtimeChatDatabaseHandle } from "@wake-surfer/realtime-chat-database";
import { describe, expect, it, vi } from "vitest";

import { createRuntimeDeps } from "../src/runtime/create-runtime-deps.js";

describe("realtime chat API runtime dependencies", () => {
  it("validates runtime configuration before creating a database pool", async () => {
    const close = vi.fn(async () => undefined);
    const migrate = vi.fn(async () => undefined);
    const database = createDatabaseHandle({ close, migrate });
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
    expect(migrate).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the database when migration fails during startup", async () => {
    const startupError = new Error("migration failed");
    const close = vi.fn(async () => undefined);
    const database = createDatabaseHandle({
      close,
      migrate: vi.fn(async () => {
        throw startupError;
      }),
    });

    await expect(
      createRuntimeDeps(requiredEnv(), {
        createDatabase: () => database,
      }),
    ).rejects.toBe(startupError);
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves startup and database cleanup errors", async () => {
    const startupError = new Error("migration failed");
    const closeError = new Error("database close failed");
    const database = createDatabaseHandle({
      close: vi.fn(async () => {
        throw closeError;
      }),
      migrate: vi.fn(async () => {
        throw startupError;
      }),
    });

    const error = await createRuntimeDeps(requiredEnv(), {
      createDatabase: () => database,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([startupError, closeError]);
  });
});

function createDatabaseHandle(
  overrides: Pick<RealtimeChatDatabaseHandle, "close" | "migrate">,
): RealtimeChatDatabaseHandle {
  return {
    db: {} as RealtimeChatDatabaseHandle["db"],
    ...overrides,
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
