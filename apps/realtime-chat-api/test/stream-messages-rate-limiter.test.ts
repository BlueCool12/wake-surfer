import { describe, expect, it, vi } from "vitest";

import {
  StreamMessagesRateLimitUnavailableError,
  createStreamMessagesQueryRateLimiter,
  type StreamMessagesRedisEval,
} from "../src/features/stream-messages/distributed-rate-limiter.js";

describe("Stream Messages distributed rate limiter", () => {
  it("requires a strong digest secret and only permits stricter finite limits", () => {
    expect(() => createLimiter(new FakeRedis(), { keyHmacSecret: "short" })).toThrow(/32/);
    expect(() => createLimiter(new FakeRedis(), { publicActorRequestsPerMinute: 121 })).toThrow(
      /120 이하/,
    );
    expect(() => createLimiter(new FakeRedis(), { syncActorRequestsPerMinute: 0 })).toThrow(
      /1 이상/,
    );
  });

  it("uses only namespaced HMAC digests as Redis keys", async () => {
    const redis = new FakeRedis();
    const limiter = createLimiter(redis);

    await limiter.checkPublic({ actorId: "actor-sensitive", sourceIp: "203.0.113.10" });

    expect(redis.lastKeys).toHaveLength(2);
    expect(redis.lastKeys[0]).toMatch(/^stream-messages:rate:v1:public-actor:[a-f0-9]{64}$/);
    expect(redis.lastKeys[1]).toMatch(/^stream-messages:rate:v1:public-ip:[a-f0-9]{64}$/);
    expect(redis.lastKeys.join(" ")).not.toContain("actor-sensitive");
    expect(redis.lastKeys.join(" ")).not.toContain("203.0.113.10");
  });

  it("shares token state across instances and returns a boundary retry delay", async () => {
    const redis = new FakeRedis();
    const firstInstance = createLimiter(redis, { publicActorRequestsPerMinute: 2 });
    const secondInstance = createLimiter(redis, { publicActorRequestsPerMinute: 2 });
    const context = { actorId: "actor-shared", sourceIp: "198.51.100.8" };

    await expect(firstInstance.checkPublic(context)).resolves.toEqual({ allowed: true });
    await expect(secondInstance.checkPublic(context)).resolves.toEqual({ allowed: true });
    await expect(firstInstance.checkPublic(context)).resolves.toEqual({
      allowed: false,
      retryAfterMs: 30_000,
    });

    redis.advanceBy(29_999);
    await expect(secondInstance.checkPublic(context)).resolves.toMatchObject({ allowed: false });
    redis.advanceBy(1);
    await expect(secondInstance.checkPublic(context)).resolves.toEqual({ allowed: true });
  });

  it("keeps public and sync actor buckets isolated", async () => {
    const redis = new FakeRedis();
    const limiter = createLimiter(redis, {
      publicActorRequestsPerMinute: 1,
      syncActorRequestsPerMinute: 1,
    });

    await expect(
      limiter.checkPublic({ actorId: "actor-1", sourceIp: "192.0.2.1" }),
    ).resolves.toEqual({ allowed: true });
    await expect(limiter.checkSyncActor({ actorId: "actor-1" })).resolves.toEqual({
      allowed: true,
    });
    await expect(limiter.checkSyncActor({ actorId: "actor-1" })).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("fails closed on Redis errors and malformed results", async () => {
    const failingRedis: StreamMessagesRedisEval = {
      eval: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
    };
    await expect(
      createLimiter(failingRedis).checkSyncActor({ actorId: "actor-1" }),
    ).rejects.toBeInstanceOf(StreamMessagesRateLimitUnavailableError);

    const malformedRedis: StreamMessagesRedisEval = {
      eval: vi.fn(async () => [1]),
    };
    await expect(
      createLimiter(malformedRedis).checkSyncActor({ actorId: "actor-1" }),
    ).rejects.toBeInstanceOf(StreamMessagesRateLimitUnavailableError);
  });
});

function createLimiter(
  redis: StreamMessagesRedisEval,
  overrides: Partial<Parameters<typeof createStreamMessagesQueryRateLimiter>[0]> = {},
) {
  return createStreamMessagesQueryRateLimiter({
    keyHmacSecret: "rate-limit-secret-that-is-at-least-32-bytes",
    redis,
    ...overrides,
  });
}

class FakeRedis implements StreamMessagesRedisEval {
  lastKeys: string[] = [];
  #now = 0;
  readonly #states = new Map<string, { tokens: number; updatedAt: number }>();

  advanceBy(milliseconds: number): void {
    this.#now += milliseconds;
  }

  async eval(_script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    this.lastKeys = options.keys;
    const states = options.keys.map((key, index) => {
      const capacity = Number(options.arguments[index * 3]);
      const window = Number(options.arguments[index * 3 + 1]);
      const cost = Number(options.arguments[index * 3 + 2]);
      const stored = this.#states.get(key) ?? { tokens: capacity, updatedAt: this.#now };
      const tokens = Math.min(
        capacity,
        stored.tokens + ((this.#now - stored.updatedAt) * capacity) / window,
      );
      const retryAfterMs = tokens < cost ? Math.ceil(((cost - tokens) * window) / capacity) : 0;
      return { capacity, cost, key, retryAfterMs, tokens, window };
    });
    const allowed = states.every((state) => state.retryAfterMs === 0);

    for (const state of states) {
      this.#states.set(state.key, {
        tokens: allowed ? state.tokens - state.cost : state.tokens,
        updatedAt: this.#now,
      });
    }

    return [allowed ? 1 : 0, Math.max(...states.map((state) => state.retryAfterMs))];
  }
}
