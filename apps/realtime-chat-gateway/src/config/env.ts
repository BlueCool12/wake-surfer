const RFC_6750_BEARER_TOKEN_PATTERN = new RegExp("^[A-Za-z0-9._~+/-]+=*$");

export type RealtimeChatGatewayConfig = {
  allowedOrigins: string[];
  apiActorHeader: string;
  apiBaseUrl: string;
  apiGatewayIdHeader: string;
  apiRequestTimeoutMilliseconds: number;
  gatewayApiToken: string;
  gatewayId: string;
  gatewayPath: string;
  heartbeatIntervalMilliseconds: number;
  host: string;
  httpHeadersTimeoutMilliseconds: number;
  httpKeepAliveTimeoutMilliseconds: number;
  httpRequestTimeoutMilliseconds: number;
  internalTransportSecurity: "development" | "direct-tls" | "service-mesh-tls";
  logLevel: string;
  maxConnections: number;
  maxPayloadBytes: number;
  maxPendingAuthentications: number;
  nodeEnvironment: "development" | "production" | "test";
  port: number;
  shutdownGraceMilliseconds: number;
};

export function loadEnv(env: NodeJS.ProcessEnv = process.env): RealtimeChatGatewayConfig {
  const nodeEnvironment = readNodeEnvironment(env);
  const internalTransportSecurity = readInternalTransportSecurity(env);
  const apiBaseUrl = readHttpUrl(env, "REALTIME_CHAT_API_BASE_URL");
  const gatewayApiToken = readRequiredString(env, "REALTIME_CHAT_GATEWAY_API_TOKEN");
  const httpHeadersTimeoutMilliseconds = readInteger(
    env,
    "REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS",
    5_000,
    { min: 1 },
  );
  const httpRequestTimeoutMilliseconds = readInteger(
    env,
    "REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS",
    10_000,
    { min: 1 },
  );
  const maxConnections = readInteger(env, "REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS", 10_000, {
    min: 1,
  });
  const maxPendingAuthentications = readInteger(
    env,
    "REALTIME_CHAT_GATEWAY_MAX_PENDING_AUTHENTICATIONS",
    256,
    { min: 1 },
  );

  if (new TextEncoder().encode(gatewayApiToken).byteLength < 32) {
    throw new Error("REALTIME_CHAT_GATEWAY_API_TOKEN must contain at least 32 UTF-8 bytes");
  }

  if (!RFC_6750_BEARER_TOKEN_PATTERN.test(gatewayApiToken)) {
    throw new Error("REALTIME_CHAT_GATEWAY_API_TOKEN must use RFC 6750 Bearer token characters");
  }

  if (nodeEnvironment === "production" && internalTransportSecurity === "development") {
    throw new Error(
      "production requires REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY to prove internal TLS",
    );
  }

  if (internalTransportSecurity === "direct-tls" && !apiBaseUrl.startsWith("https:")) {
    throw new Error("direct-tls requires an HTTPS REALTIME_CHAT_API_BASE_URL");
  }

  if (httpHeadersTimeoutMilliseconds > httpRequestTimeoutMilliseconds) {
    throw new Error(
      "REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS must be less than or equal to REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS",
    );
  }

  if (maxPendingAuthentications > maxConnections) {
    throw new Error(
      "REALTIME_CHAT_GATEWAY_MAX_PENDING_AUTHENTICATIONS must be less than or equal to REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS",
    );
  }

  return {
    allowedOrigins: readOrigins(env),
    apiActorHeader: readHeaderName(
      env,
      "REALTIME_CHAT_API_ASSERTED_ACTOR_HEADER",
      "x-realtime-chat-actor-id",
    ),
    apiBaseUrl,
    apiGatewayIdHeader: readHeaderName(env, "REALTIME_CHAT_API_GATEWAY_ID_HEADER", "x-gateway-id"),
    apiRequestTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_API_REQUEST_TIMEOUT_MS",
      10_000,
      { min: 100 },
    ),
    gatewayApiToken,
    gatewayId: readRequiredString(env, "REALTIME_CHAT_GATEWAY_ID"),
    gatewayPath: readPath(env, "REALTIME_CHAT_GATEWAY_PATH", "/realtime-chat"),
    heartbeatIntervalMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_GATEWAY_HEARTBEAT_INTERVAL_MS",
      30_000,
      { min: 1 },
    ),
    host: readOptionalString(env, "HOST", "0.0.0.0"),
    httpHeadersTimeoutMilliseconds,
    httpKeepAliveTimeoutMilliseconds: readInteger(
      env,
      "REALTIME_CHAT_GATEWAY_HTTP_KEEP_ALIVE_TIMEOUT_MS",
      5_000,
      { min: 1 },
    ),
    httpRequestTimeoutMilliseconds,
    internalTransportSecurity,
    logLevel: readOptionalString(env, "LOG_LEVEL", "info"),
    maxConnections,
    maxPayloadBytes: readInteger(env, "REALTIME_CHAT_GATEWAY_MAX_PAYLOAD_BYTES", 65_536, {
      min: 1,
    }),
    maxPendingAuthentications,
    nodeEnvironment,
    port: readInteger(env, "PORT", 3001, { max: 65_535, min: 1 }),
    shutdownGraceMilliseconds: readInteger(env, "REALTIME_CHAT_GATEWAY_SHUTDOWN_GRACE_MS", 5_000, {
      min: 1,
    }),
  };
}

function readNodeEnvironment(env: NodeJS.ProcessEnv): RealtimeChatGatewayConfig["nodeEnvironment"] {
  const value = readOptionalString(env, "NODE_ENV", "development");

  if (value === "development" || value === "production" || value === "test") {
    return value;
  }

  throw new Error("NODE_ENV must be development, production, or test");
}

function readInternalTransportSecurity(
  env: NodeJS.ProcessEnv,
): RealtimeChatGatewayConfig["internalTransportSecurity"] {
  const value = readOptionalString(env, "REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY", "development");

  if (value === "development" || value === "direct-tls" || value === "service-mesh-tls") {
    return value;
  }

  throw new Error(
    "REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY must be development, direct-tls, or service-mesh-tls",
  );
}

function readOrigins(env: NodeJS.ProcessEnv): string[] {
  const value = readOptionalString(
    env,
    "REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS",
    "http://localhost:5173",
  );
  const origins = [
    ...new Set(
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];

  if (origins.length === 0) {
    throw new Error("REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS must contain at least one origin");
  }

  for (const origin of origins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS must contain valid origins");
    }

    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin) {
      throw new Error(
        "REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS must contain HTTP origins without paths",
      );
    }
  }

  return origins;
}

function readHttpUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = readRequiredString(env, name);
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  return url.toString();
}

function readHeaderName(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = readOptionalString(env, name, fallback).toLowerCase();

  try {
    new Headers({ [value]: "validation" });
  } catch {
    throw new Error(`${name} must be a valid HTTP header name`);
  }

  return value;
}

function readPath(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = readOptionalString(env, name, fallback);

  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must be an absolute URL path`);
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

function readOptionalString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value || fallback;
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  limits: { max?: number; min?: number },
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
