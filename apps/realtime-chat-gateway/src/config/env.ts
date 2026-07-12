export type RealtimeChatGatewayConfig = {
  allowedOrigins: string[];
  apiBaseUrl: string;
  apiGatewayIdHeader: string;
  apiRequestTimeoutMilliseconds: number;
  gatewayId: string;
  gatewayPath: string;
  heartbeatIntervalMilliseconds: number;
  host: string;
  httpHeadersTimeoutMilliseconds: number;
  httpKeepAliveTimeoutMilliseconds: number;
  httpRequestTimeoutMilliseconds: number;
  logLevel: string;
  maxConnections: number;
  maxPayloadBytes: number;
  maxPendingAuthentications: number;
  port: number;
  shutdownGraceMilliseconds: number;
  ticketHeader: string;
};

export function loadEnv(env: NodeJS.ProcessEnv = process.env): RealtimeChatGatewayConfig {
  const config: RealtimeChatGatewayConfig = {
    allowedOrigins: readCsv(env, "REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS"),
    apiBaseUrl: readRequiredUrl(env, "REALTIME_CHAT_API_BASE_URL"),
    apiGatewayIdHeader: readOptionalString(
      env,
      "REALTIME_CHAT_API_GATEWAY_ID_HEADER",
      "x-gateway-id",
    ).toLowerCase(),
    apiRequestTimeoutMilliseconds: readInteger(env, "REALTIME_CHAT_API_REQUEST_TIMEOUT_MS", 3_000, {
      min: 1,
    }),
    gatewayId: readRequiredString(env, "REALTIME_CHAT_GATEWAY_ID"),
    gatewayPath: readPath(env, "REALTIME_CHAT_GATEWAY_PATH", "/realtime-chat"),
    heartbeatIntervalMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_GATEWAY_HEARTBEAT_INTERVAL_MS",
      30_000,
      { min: 1 },
    ),
    host: readOptionalString(env, "HOST", "0.0.0.0"),
    httpHeadersTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS",
      5_000,
      { min: 1 },
    ),
    httpKeepAliveTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_GATEWAY_HTTP_KEEP_ALIVE_TIMEOUT_MS",
      5_000,
      { min: 1 },
    ),
    httpRequestTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS",
      10_000,
      { min: 1 },
    ),
    logLevel: readOptionalString(env, "LOG_LEVEL", "info"),
    maxConnections: readInteger(env, "REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS", 10_000, {
      min: 1,
    }),
    maxPayloadBytes: readInteger(env, "REALTIME_CHAT_GATEWAY_MAX_PAYLOAD_BYTES", 65_536, {
      min: 1,
    }),
    maxPendingAuthentications: readInteger(
      env,
      "REALTIME_CHAT_GATEWAY_MAX_PENDING_AUTHENTICATIONS",
      256,
      { min: 1 },
    ),
    port: readInteger(env, "PORT", 3001, {
      max: 65_535,
      min: 1,
    }),
    shutdownGraceMilliseconds: readInteger(env, "REALTIME_CHAT_GATEWAY_SHUTDOWN_GRACE_MS", 10_000, {
      min: 1,
    }),
    ticketHeader: readOptionalString(
      env,
      "REALTIME_CHAT_GATEWAY_TICKET_HEADER",
      "x-gateway-ticket",
    ).toLowerCase(),
  };

  if (config.httpHeadersTimeoutMilliseconds > config.httpRequestTimeoutMilliseconds) {
    throw new Error(
      "REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS 값은 REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS 이하여야 합니다",
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
    throw new Error(`${name} 값이 필요합니다`);
  }

  return value;
}

function readOptionalString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value || fallback;
}

function readRequiredUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = readRequiredString(env, name);

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} 값은 올바른 URL이어야 합니다`);
  }
}

function readPath(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = readOptionalString(env, name, fallback);

  if (!value.startsWith("/")) {
    throw new Error(`${name} 값은 /로 시작해야 합니다`);
  }

  return value;
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
    throw new Error(`${name} 값은 정수여야 합니다`);
  }

  if (limits.min !== undefined && value < limits.min) {
    throw new Error(`${name} 값은 ${limits.min} 이상이어야 합니다`);
  }

  if (limits.max !== undefined && value > limits.max) {
    throw new Error(`${name} 값은 ${limits.max} 이하여야 합니다`);
  }

  return value;
}
