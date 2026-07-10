export type RealtimeChatApiConfig = {
  actorIdHeader: string;
  databaseUrl: string;
  gatewayId: string;
  gatewayIdHeader: string;
  gatewayTicketRawBytes: number;
  gatewayTicketTtlMilliseconds: number;
  gatewayUrl: string;
  logLevel: string;
  port: number;
  postgresPool: {
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    max: number;
    maxLifetimeSeconds: number;
  };
};

export function loadEnv(env: NodeJS.ProcessEnv = process.env): RealtimeChatApiConfig {
  return {
    actorIdHeader: readOptionalString(env, "REALTIME_CHAT_ACTOR_ID_HEADER", "x-actor-id"),
    databaseUrl: readRequiredString(env, "REALTIME_CHAT_DATABASE_URL"),
    gatewayId: readRequiredString(env, "REALTIME_CHAT_GATEWAY_ID"),
    gatewayIdHeader: readOptionalString(env, "REALTIME_CHAT_GATEWAY_ID_HEADER", "x-gateway-id"),
    gatewayTicketRawBytes: readInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES", 32, {
      min: 16,
    }),
    gatewayTicketTtlMilliseconds: readInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_TTL_MS", 60_000, {
      min: 1_000,
    }),
    gatewayUrl: readRequiredString(env, "REALTIME_CHAT_GATEWAY_URL"),
    logLevel: readOptionalString(env, "LOG_LEVEL", "info"),
    port: readInteger(env, "PORT", 3000, {
      max: 65_535,
      min: 1,
    }),
    postgresPool: {
      connectionTimeoutMillis: readInteger(
        env,
        "REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS",
        2_000,
        {
          min: 1,
        },
      ),
      idleTimeoutMillis: readInteger(env, "REALTIME_CHAT_POSTGRES_IDLE_TIMEOUT_MS", 30_000, {
        min: 1,
      }),
      max: readInteger(env, "REALTIME_CHAT_POSTGRES_POOL_MAX", 10, {
        min: 1,
      }),
      maxLifetimeSeconds: readInteger(env, "REALTIME_CHAT_POSTGRES_MAX_LIFETIME_SECONDS", 300, {
        min: 1,
      }),
    },
  };
}

function readRequiredString(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readOptionalString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value || fallback;
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  limits: {
    max?: number;
    min?: number;
  },
): number {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }

  if (limits.min !== undefined && value < limits.min) {
    throw new Error(`${name} must be greater than or equal to ${limits.min}`);
  }

  if (limits.max !== undefined && value > limits.max) {
    throw new Error(`${name} must be less than or equal to ${limits.max}`);
  }

  return value;
}
