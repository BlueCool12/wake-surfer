import { describe, expect, it, vi } from "vitest";

import { closeGatewayRuntime } from "../src/runtime/close-runtime.js";

describe("realtime chat gateway runtime shutdown", () => {
  it("closes runtime resources even when app shutdown fails", async () => {
    const closeRuntime = vi.fn(async () => {});

    await expect(
      closeGatewayRuntime({
        closeApp: vi.fn(async () => {
          throw new Error("app close failed");
        }),
        closeRuntime,
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(closeRuntime).toHaveBeenCalledOnce();
  });

  it("aggregates failures from both resource boundaries", async () => {
    const result = closeGatewayRuntime({
      closeApp: vi.fn(async () => {
        throw new Error("app close failed");
      }),
      closeRuntime: vi.fn(async () => {
        throw new Error("runtime close failed");
      }),
    });

    await expect(result).rejects.toMatchObject({
      errors: [expect.any(Error), expect.any(Error)],
    });
  });
});
