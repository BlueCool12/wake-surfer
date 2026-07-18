import { createHmac } from "node:crypto";

export const DEFAULT_PUBLIC_ACTOR_REQUESTS_PER_MINUTE = 120;
export const DEFAULT_PUBLIC_IP_REQUESTS_PER_MINUTE = 300;
export const DEFAULT_SYNC_ACTOR_REQUESTS_PER_MINUTE = 120;
export const STREAM_MESSAGES_RATE_LIMIT_WINDOW_MS = 60_000;

export const STREAM_MESSAGES_TOKEN_BUCKET_LUA = `
local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local allowed = 1
local max_retry_after_ms = 0
local states = {}

for index, key in ipairs(KEYS) do
  local offset = ((index - 1) * 3)
  local capacity = tonumber(ARGV[offset + 1])
  local window_ms = tonumber(ARGV[offset + 2])
  local cost = tonumber(ARGV[offset + 3])
  local stored = redis.call('HMGET', key, 'tokens', 'updated_at_ms')
  local tokens = tonumber(stored[1]) or capacity
  local updated_at_ms = tonumber(stored[2]) or now_ms
  local elapsed_ms = math.max(0, now_ms - updated_at_ms)
  tokens = math.min(capacity, tokens + ((elapsed_ms * capacity) / window_ms))
  local retry_after_ms = 0

  if tokens < cost then
    allowed = 0
    retry_after_ms = math.ceil(((cost - tokens) * window_ms) / capacity)
    max_retry_after_ms = math.max(max_retry_after_ms, retry_after_ms)
  end

  states[index] = { key, tokens, window_ms, cost }
end

for index, state in ipairs(states) do
  local tokens = state[2]
  if allowed == 1 then
    tokens = tokens - state[4]
  end
  redis.call('HMSET', state[1], 'tokens', tostring(tokens), 'updated_at_ms', tostring(now_ms))
  redis.call('PEXPIRE', state[1], math.ceil(state[3] * 2))
end

return { allowed, max_retry_after_ms }
`;

export type StreamMessagesRedisEval = {
  eval: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
};

export type StreamMessagesRateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterMs: number };

export type StreamMessagesQueryRateLimiter = {
  checkPublic: (context: {
    actorId: string;
    sourceIp: string;
  }) => Promise<StreamMessagesRateLimitDecision>;
  checkSyncActor: (context: { actorId: string }) => Promise<StreamMessagesRateLimitDecision>;
};

export type CreateStreamMessagesQueryRateLimiterOptions = {
  keyHmacSecret: string;
  redis: StreamMessagesRedisEval;
  publicActorRequestsPerMinute?: number;
  publicIpRequestsPerMinute?: number;
  syncActorRequestsPerMinute?: number;
};

export class StreamMessagesRateLimitUnavailableError extends Error {
  constructor() {
    super("Stream Messages distributed rate limit를 사용할 수 없습니다.");
    this.name = "StreamMessagesRateLimitUnavailableError";
  }
}

type Bucket = {
  capacity: number;
  scope: "public-actor" | "public-ip" | "sync-actor";
  subject: string;
};

export function createStreamMessagesQueryRateLimiter(
  options: CreateStreamMessagesQueryRateLimiterOptions,
): StreamMessagesQueryRateLimiter {
  const keyHmacSecret = parseKeySecret(options.keyHmacSecret);
  const publicActorCapacity = parseCapacity(
    options.publicActorRequestsPerMinute,
    DEFAULT_PUBLIC_ACTOR_REQUESTS_PER_MINUTE,
    "publicActorRequestsPerMinute",
  );
  const publicIpCapacity = parseCapacity(
    options.publicIpRequestsPerMinute,
    DEFAULT_PUBLIC_IP_REQUESTS_PER_MINUTE,
    "publicIpRequestsPerMinute",
  );
  const syncActorCapacity = parseCapacity(
    options.syncActorRequestsPerMinute,
    DEFAULT_SYNC_ACTOR_REQUESTS_PER_MINUTE,
    "syncActorRequestsPerMinute",
  );

  return {
    checkPublic: ({ actorId, sourceIp }) =>
      consume(options.redis, keyHmacSecret, [
        {
          capacity: publicActorCapacity,
          scope: "public-actor",
          subject: parseSubject(actorId, "actorId"),
        },
        {
          capacity: publicIpCapacity,
          scope: "public-ip",
          subject: parseSubject(sourceIp, "sourceIp"),
        },
      ]),
    checkSyncActor: ({ actorId }) =>
      consume(options.redis, keyHmacSecret, [
        {
          capacity: syncActorCapacity,
          scope: "sync-actor",
          subject: parseSubject(actorId, "actorId"),
        },
      ]),
  };
}

async function consume(
  redis: StreamMessagesRedisEval,
  keyHmacSecret: string,
  buckets: Bucket[],
): Promise<StreamMessagesRateLimitDecision> {
  const keys = buckets.map(
    (bucket) =>
      `stream-messages:rate:v1:${bucket.scope}:${createSubjectDigest(
        keyHmacSecret,
        bucket.scope,
        bucket.subject,
      )}`,
  );
  const arguments_ = buckets.flatMap((bucket) => [
    String(bucket.capacity),
    String(STREAM_MESSAGES_RATE_LIMIT_WINDOW_MS),
    "1",
  ]);

  let rawResult: unknown;

  try {
    rawResult = await redis.eval(STREAM_MESSAGES_TOKEN_BUCKET_LUA, {
      keys,
      arguments: arguments_,
    });
  } catch {
    throw new StreamMessagesRateLimitUnavailableError();
  }

  const result = parseRedisResult(rawResult);

  if (result.allowed) {
    return { allowed: true };
  }

  return { allowed: false, retryAfterMs: result.retryAfterMs };
}

function parseRedisResult(value: unknown): { allowed: boolean; retryAfterMs: number } {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new StreamMessagesRateLimitUnavailableError();
  }

  const allowed = Number(value[0]);
  const retryAfterMs = Number(value[1]);

  if (
    (allowed !== 0 && allowed !== 1) ||
    !Number.isSafeInteger(retryAfterMs) ||
    retryAfterMs < 0 ||
    (allowed === 0 && retryAfterMs === 0)
  ) {
    throw new StreamMessagesRateLimitUnavailableError();
  }

  return { allowed: allowed === 1, retryAfterMs };
}

function createSubjectDigest(secret: string, scope: Bucket["scope"], subject: string): string {
  return createHmac("sha256", secret).update(scope).update("\0").update(subject).digest("hex");
}

function parseKeySecret(value: string): string {
  const secret = parseSubject(value, "keyHmacSecret");

  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new TypeError("keyHmacSecret은 최소 32 UTF-8 byte여야 합니다.");
  }

  return secret;
}

function parseCapacity(value: number | undefined, maximum: number, label: string): number {
  const capacity = value ?? maximum;

  if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > maximum) {
    throw new TypeError(`${label}은 1 이상 ${maximum} 이하의 safe integer여야 합니다.`);
  }

  return capacity;
}

function parseSubject(value: string, label: string): string {
  const parsed = value.trim();

  if (parsed.length === 0 || parsed !== value) {
    throw new TypeError(`${label}은 공백 없는 문자열이어야 합니다.`);
  }

  return parsed;
}
