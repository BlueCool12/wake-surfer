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

  it("assembles the MVP message vertical slice without running migrations and exposes cleanup", async () => {
    const close = vi.fn(async () => undefined);
    const database = createDatabaseHandle(close);
    const createDatabase = vi.fn(() => database);

    const runtime = await createRuntimeDeps(requiredEnv(), {
      createDatabase,
    });

    expect(createDatabase).toHaveBeenCalledWith({
      databaseUrl: "postgres://localhost/wake_surfer",
      pool: expect.objectContaining({
        connectionTimeoutMillis: 2_000,
        statementTimeoutMillis: 5_000,
      }),
    });
    expect(runtime.appDeps.messageSend?.send).toEqual(expect.any(Function));
    expect(runtime.appDeps.loadLatestMessages).toEqual(expect.any(Function));
    expect(runtime.appDeps.loadOlderMessages).toEqual(expect.any(Function));
    expect(runtime.appDeps.syncAfterMessages).toEqual(expect.any(Function));
    expect(runtime.appDeps.checkReadiness).toEqual(expect.any(Function));
    expect(runtime.appDeps.cors?.allowedHeaders).toContain("x-actor-id");
    expect(runtime.appDeps.operationAbortMilliseconds).toBe(8_000);
    expect(runtime.appDeps.requestBodyLimitBytes).toBe(16_384);
    expect(close).not.toHaveBeenCalled();
    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("checks database readiness without depending on a domain table", async () => {
    const executeTakeFirstOrThrow = vi.fn(async () => ({ ready: 1 }));
    const selectNoFrom = vi.fn(() => ({ executeTakeFirstOrThrow }));
    const database = createDatabaseHandle(
      vi.fn(async () => undefined),
      {
        selectNoFrom,
      } as unknown as RealtimeChatDatabaseHandle["db"],
    );
    const runtime = await createRuntimeDeps(requiredEnv(), {
      createDatabase: () => database,
    });

    await runtime.appDeps.checkReadiness?.();

    expect(selectNoFrom).toHaveBeenCalledOnce();
    expect(executeTakeFirstOrThrow).toHaveBeenCalledOnce();
  });
});

function createDatabaseHandle(
  close: RealtimeChatDatabaseHandle["close"],
  db: RealtimeChatDatabaseHandle["db"] = {} as RealtimeChatDatabaseHandle["db"],
): RealtimeChatDatabaseHandle {
  return {
    db,
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
