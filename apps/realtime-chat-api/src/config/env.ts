import {
  MAX_GATEWAY_TICKET_RAW_BYTES,
  MIN_GATEWAY_TICKET_RAW_BYTES,
} from "@wake-surfer/realtime-chat-gateway-ticket";

const RFC_6750_BEARER_TOKEN_PATTERN = new RegExp("^[A-Za-z0-9._~+/-]+=*$");

export type RealtimeChatApiConfig = {
  actorAuthSecurity: "development" | "trusted-edge";
  actorIdHeader: string;
  corsAllowedOrigins: string[];
  databaseUrl: string;
  gatewayApiToken: string;
  gatewayAssertedActorHeader: string;
  gatewayId: string;
  gatewayIdHeader: string;
  gatewayTicketRawBytes: number;
  gatewayTicketTtlMilliseconds: number;
  gatewayUrl: string;
  host: string;
  httpHeadersTimeoutMilliseconds: number;
  httpKeepAliveTimeoutMilliseconds: number;
  httpRequestTimeoutMilliseconds: number;
  logLevel: "debug" | "error" | "fatal" | "info" | "silent" | "trace" | "warn";
  nodeEnvironment: "development" | "production" | "test";
  operationAbortMilliseconds: number;
  port: number;
  requestTimeoutMilliseconds: number;
  shutdownGraceMilliseconds: number;
  internalTransportSecurity: "development" | "direct-tls" | "service-mesh-tls";
  postgresPool: {
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    max: number;
    maxLifetimeSeconds: number;
    statementTimeoutMillis: number;
  };
};

export function loadEnv(env: NodeJS.ProcessEnv = process.env): RealtimeChatApiConfig {
  rejectRemovedSetting(
    env,
    "REALTIME_CHAT_REQUEST_BODY_LIMIT_BYTES",
    "HTTP request body 상한은 65536-byte 코드 계약으로 고정되었습니다.",
  );
  const nodeEnvironment = readNodeEnvironment(env);
  const internalTransportSecurity = readInternalTransportSecurity(env);
  const actorAuthSecurity = readActorAuthSecurity(env);
  const gatewayApiToken = readRequiredString(env, "REALTIME_CHAT_GATEWAY_API_TOKEN");
  const gatewayUrl = readRequiredString(env, "REALTIME_CHAT_GATEWAY_URL");
  const operationAbortMilliseconds = readRequiredInteger(env, "REALTIME_CHAT_OPERATION_ABORT_MS", {
    min: 1,
  });
  const requestTimeoutMilliseconds = readRequiredInteger(env, "REALTIME_CHAT_REQUEST_TIMEOUT_MS", {
    min: 100,
  });
  const httpRequestTimeoutMilliseconds = readRequiredInteger(
    env,
    "REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS",
    {
      min: 1,
    },
  );
  const httpHeadersTimeoutMilliseconds = readRequiredInteger(
    env,
    "REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS",
    {
      min: 1,
    },
  );
  const postgresConnectionTimeoutMilliseconds = readRequiredInteger(
    env,
    "REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS",
    {
      min: 1,
    },
  );
  const postgresStatementTimeoutMilliseconds = readRequiredInteger(
    env,
    "REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS",
    {
      min: 1,
    },
  );

  if (new TextEncoder().encode(gatewayApiToken).byteLength < 32) {
    throw new Error("REALTIME_CHAT_GATEWAY_API_TOKEN must contain at least 32 UTF-8 bytes");
  }

  if (!RFC_6750_BEARER_TOKEN_PATTERN.test(gatewayApiToken)) {
    throw new Error("REALTIME_CHAT_GATEWAY_API_TOKEN must use RFC 6750 Bearer token characters");
  }

  if (nodeEnvironment === "production" && internalTransportSecurity === "development") {
    throw new Error(
      "production requires REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY to prove direct or service-mesh TLS",
    );
  }

  if (nodeEnvironment === "production" && actorAuthSecurity !== "trusted-edge") {
    throw new Error("production requires REALTIME_CHAT_ACTOR_AUTH_SECURITY=trusted-edge");
  }

  if (operationAbortMilliseconds >= requestTimeoutMilliseconds) {
    throw new Error(
      "REALTIME_CHAT_OPERATION_ABORT_MS must be less than REALTIME_CHAT_REQUEST_TIMEOUT_MS",
    );
  }

  if (
    postgresConnectionTimeoutMilliseconds + postgresStatementTimeoutMilliseconds >=
    operationAbortMilliseconds
  ) {
    throw new Error(
      "REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS and REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS must leave time before REALTIME_CHAT_OPERATION_ABORT_MS",
    );
  }

  if (httpHeadersTimeoutMilliseconds > httpRequestTimeoutMilliseconds) {
    throw new Error(
      "REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS must be less than or equal to REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS",
    );
  }

  const parsedGatewayUrl = new URL(gatewayUrl);

  if (parsedGatewayUrl.protocol !== "ws:" && parsedGatewayUrl.protocol !== "wss:") {
    throw new Error("REALTIME_CHAT_GATEWAY_URL must use ws or wss");
  }

  if (nodeEnvironment === "production" && parsedGatewayUrl.protocol !== "wss:") {
    throw new Error("production REALTIME_CHAT_GATEWAY_URL must use wss");
  }

  return {
    actorAuthSecurity,
    actorIdHeader: readHeaderName(env, "REALTIME_CHAT_ACTOR_ID_HEADER"),
    corsAllowedOrigins: readCorsAllowedOrigins(env),
    databaseUrl: readRequiredString(env, "REALTIME_CHAT_DATABASE_URL"),
    gatewayApiToken,
    gatewayAssertedActorHeader: readHeaderName(env, "REALTIME_CHAT_GATEWAY_ASSERTED_ACTOR_HEADER"),
    gatewayId: readRequiredString(env, "REALTIME_CHAT_GATEWAY_ID"),
    gatewayIdHeader: readHeaderName(env, "REALTIME_CHAT_GATEWAY_ID_HEADER"),
    gatewayTicketRawBytes: readRequiredInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES", {
      max: MAX_GATEWAY_TICKET_RAW_BYTES,
      min: MIN_GATEWAY_TICKET_RAW_BYTES,
    }),
    gatewayTicketTtlMilliseconds: readRequiredInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_TTL_MS", {
      min: 1_000,
    }),
    gatewayUrl,
    host: readRequiredString(env, "HOST"),
    httpHeadersTimeoutMilliseconds,
    httpKeepAliveTimeoutMilliseconds: readRequiredInteger(
      env,
      "REALTIME_CHAT_HTTP_KEEP_ALIVE_TIMEOUT_MS",
      {
        min: 1,
      },
    ),
    httpRequestTimeoutMilliseconds,
    internalTransportSecurity,
    logLevel: readLogLevel(env),
    nodeEnvironment,
    operationAbortMilliseconds,
    port: readRequiredInteger(env, "PORT", {
      max: 65_535,
      min: 1,
    }),
    requestTimeoutMilliseconds,
    shutdownGraceMilliseconds: readRequiredInteger(env, "REALTIME_CHAT_SHUTDOWN_GRACE_MS", {
      min: 1,
    }),
    postgresPool: {
      connectionTimeoutMillis: postgresConnectionTimeoutMilliseconds,
      idleTimeoutMillis: readRequiredInteger(env, "REALTIME_CHAT_POSTGRES_IDLE_TIMEOUT_MS", {
        min: 1,
      }),
      max: readRequiredInteger(env, "REALTIME_CHAT_POSTGRES_POOL_MAX", {
        min: 1,
      }),
      maxLifetimeSeconds: readRequiredInteger(env, "REALTIME_CHAT_POSTGRES_MAX_LIFETIME_SECONDS", {
        min: 1,
      }),
      statementTimeoutMillis: postgresStatementTimeoutMilliseconds,
    },
  };
}

function rejectRemovedSetting(env: NodeJS.ProcessEnv, name: string, reason: string): void {
  if (env[name] !== undefined) {
    throw new Error(`${name} is no longer supported. ${reason}`);
  }
}

function readActorAuthSecurity(env: NodeJS.ProcessEnv): RealtimeChatApiConfig["actorAuthSecurity"] {
  const value = readRequiredString(env, "REALTIME_CHAT_ACTOR_AUTH_SECURITY");

  if (value === "development" || value === "trusted-edge") {
    return value;
  }

  throw new Error("REALTIME_CHAT_ACTOR_AUTH_SECURITY must be development or trusted-edge");
}

function readCorsAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const rawValue = readRequiredString(env, "REALTIME_CHAT_CORS_ALLOWED_ORIGINS");
  const origins = [
    ...new Set(
      rawValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  if (origins.length === 0) {
    throw new Error("REALTIME_CHAT_CORS_ALLOWED_ORIGINS must contain at least one origin");
  }

  for (const origin of origins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("REALTIME_CHAT_CORS_ALLOWED_ORIGINS must contain valid origins");
    }

    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin) {
      throw new Error("REALTIME_CHAT_CORS_ALLOWED_ORIGINS must contain HTTP origins without paths");
    }
  }

  return origins;
}

function readNodeEnvironment(env: NodeJS.ProcessEnv): RealtimeChatApiConfig["nodeEnvironment"] {
  const value = readRequiredString(env, "NODE_ENV");

  if (value === "development" || value === "production" || value === "test") {
    return value;
  }

  throw new Error("NODE_ENV must be development, production, or test");
}

function readInternalTransportSecurity(
  env: NodeJS.ProcessEnv,
): RealtimeChatApiConfig["internalTransportSecurity"] {
  const value = readRequiredString(env, "REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY");

  if (value === "development" || value === "direct-tls" || value === "service-mesh-tls") {
    return value;
  }

  throw new Error(
    "REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY must be development, direct-tls, or service-mesh-tls",
  );
}

function readLogLevel(env: NodeJS.ProcessEnv): RealtimeChatApiConfig["logLevel"] {
  const value = readRequiredString(env, "LOG_LEVEL");

  if (
    value === "trace" ||
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "fatal" ||
    value === "silent"
  ) {
    return value;
  }

  throw new Error("LOG_LEVEL must be trace, debug, info, warn, error, fatal, or silent");
}

function readHeaderName(env: NodeJS.ProcessEnv, name: string): string {
  const value = readRequiredString(env, name).toLowerCase();

  try {
    new Headers({ [value]: "validation" });
  } catch {
    throw new Error(`${name} must be a valid HTTP header name`);
  }

  return value;
}

function readRequiredString(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readRequiredInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  limits: {
    max?: number;
    min?: number;
  },
): number {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    throw new Error(`${name} is required`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }

  if (limits.min !== undefined && value < limits.min) {
    throw new Error(`${name} must be greater than or equal to ${limits.min}`);
  }

  if (limits.max !== undefined && value > limits.max) {
    throw new Error(`${name} must be less than or equal to ${limits.max}`);
  }

  return value;
}
