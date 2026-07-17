import {
  MAX_GATEWAY_TICKET_RAW_BYTES,
  MIN_GATEWAY_TICKET_RAW_BYTES,
} from "@wake-surfer/realtime-chat-gateway-ticket";

export type RealtimeChatApiConfig = {
  actorIdHeader: string;
  corsOrigins: string[];
  databaseUrl: string;
  gatewayId: string;
  gatewayIdHeader: string;
  gatewayTicketRawBytes: number;
  gatewayTicketTtlMilliseconds: number;
  gatewayUrl: string;
  handlerTimeoutMilliseconds: number;
  httpHeadersTimeoutMilliseconds: number;
  httpKeepAliveTimeoutMilliseconds: number;
  httpRequestTimeoutMilliseconds: number;
  logLevel: string;
  port: number;
  postgresPool: {
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    max: number;
    maxLifetimeSeconds: number;
    statementTimeoutMillis: number;
  };
  requestBodyLimitBytes: number;
  shutdownGraceMilliseconds: number;
};

export function loadEnv(env: NodeJS.ProcessEnv = process.env): RealtimeChatApiConfig {
  const handlerTimeoutMilliseconds = readInteger(env, "REALTIME_CHAT_HANDLER_TIMEOUT_MS", 5_000, {
    min: 1,
  });
  const statementTimeoutMillis = readInteger(
    env,
    "REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS",
    2_000,
    { min: 1 },
  );
  const config: RealtimeChatApiConfig = {
    actorIdHeader: readOptionalString(env, "REALTIME_CHAT_ACTOR_ID_HEADER", "x-actor-id"),
    corsOrigins: readCsv(env, "REALTIME_CHAT_CORS_ORIGINS"),
    databaseUrl: readRequiredString(env, "REALTIME_CHAT_DATABASE_URL"),
    gatewayId: readRequiredString(env, "REALTIME_CHAT_GATEWAY_ID"),
    gatewayIdHeader: readOptionalString(env, "REALTIME_CHAT_GATEWAY_ID_HEADER", "x-gateway-id"),
    gatewayTicketRawBytes: readInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES", 32, {
      max: MAX_GATEWAY_TICKET_RAW_BYTES,
      min: MIN_GATEWAY_TICKET_RAW_BYTES,
    }),
    gatewayTicketTtlMilliseconds: readInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_TTL_MS", 60_000, {
      min: 1_000,
    }),
    gatewayUrl: readRequiredString(env, "REALTIME_CHAT_GATEWAY_URL"),
    handlerTimeoutMilliseconds,
    httpHeadersTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS",
      5_000,
      { min: 1 },
    ),
    httpKeepAliveTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_HTTP_KEEP_ALIVE_TIMEOUT_MS",
      5_000,
      { min: 1 },
    ),
    httpRequestTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS",
      10_000,
      { min: 1 },
    ),
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
      statementTimeoutMillis,
    },
    requestBodyLimitBytes: readInteger(env, "REALTIME_CHAT_REQUEST_BODY_LIMIT_BYTES", 16_384, {
      min: 1,
    }),
    shutdownGraceMilliseconds: readInteger(env, "REALTIME_CHAT_SHUTDOWN_GRACE_MS", 10_000, {
      min: 1,
    }),
  };

  if (config.handlerTimeoutMilliseconds >= config.httpRequestTimeoutMilliseconds) {
    throw new Error(
      "REALTIME_CHAT_HANDLER_TIMEOUT_MS must be less than REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS",
    );
  }

  if (
    config.postgresPool.connectionTimeoutMillis + config.postgresPool.statementTimeoutMillis >=
    config.handlerTimeoutMilliseconds
  ) {
    throw new Error(
      "REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS and REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS must leave time before REALTIME_CHAT_HANDLER_TIMEOUT_MS",
    );
  }

  if (config.httpHeadersTimeoutMilliseconds > config.httpRequestTimeoutMilliseconds) {
    throw new Error(
      "REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS must be less than or equal to REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS",
    );
  }

  return config;
}

function readCsv(env: NodeJS.ProcessEnv, name: string): string[] {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    return [];
  }

  return [
    ...new Set(
      rawValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
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
