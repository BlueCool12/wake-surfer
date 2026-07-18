import {
  MAX_GATEWAY_TICKET_RAW_BYTES,
  MIN_GATEWAY_TICKET_RAW_BYTES,
} from "@wake-surfer/realtime-chat-gateway-ticket";

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
  logLevel: string;
  nodeEnvironment: "development" | "production" | "test";
  port: number;
  requestTimeoutMilliseconds: number;
  internalTransportSecurity: "development" | "direct-tls" | "service-mesh-tls";
  postgresPool: {
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    max: number;
    maxLifetimeSeconds: number;
  };
};

export function loadEnv(env: NodeJS.ProcessEnv = process.env): RealtimeChatApiConfig {
  const nodeEnvironment = readNodeEnvironment(env);
  const internalTransportSecurity = readInternalTransportSecurity(env);
  const actorAuthSecurity = readActorAuthSecurity(env);
  const gatewayApiToken = readRequiredString(env, "REALTIME_CHAT_GATEWAY_API_TOKEN");
  const gatewayUrl = readRequiredString(env, "REALTIME_CHAT_GATEWAY_URL");

  if (new TextEncoder().encode(gatewayApiToken).byteLength < 32) {
    throw new Error("REALTIME_CHAT_GATEWAY_API_TOKEN must contain at least 32 UTF-8 bytes");
  }

  if (nodeEnvironment === "production" && internalTransportSecurity === "development") {
    throw new Error(
      "production requires REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY to prove direct or service-mesh TLS",
    );
  }

  if (nodeEnvironment === "production" && actorAuthSecurity !== "trusted-edge") {
    throw new Error("production requires REALTIME_CHAT_ACTOR_AUTH_SECURITY=trusted-edge");
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
    actorIdHeader: readOptionalString(env, "REALTIME_CHAT_ACTOR_ID_HEADER", "x-actor-id"),
    corsAllowedOrigins: readCorsAllowedOrigins(env),
    databaseUrl: readRequiredString(env, "REALTIME_CHAT_DATABASE_URL"),
    gatewayApiToken,
    gatewayAssertedActorHeader: readOptionalString(
      env,
      "REALTIME_CHAT_GATEWAY_ASSERTED_ACTOR_HEADER",
      "x-realtime-chat-actor-id",
    ),
    gatewayId: readRequiredString(env, "REALTIME_CHAT_GATEWAY_ID"),
    gatewayIdHeader: readOptionalString(env, "REALTIME_CHAT_GATEWAY_ID_HEADER", "x-gateway-id"),
    gatewayTicketRawBytes: readInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES", 32, {
      max: MAX_GATEWAY_TICKET_RAW_BYTES,
      min: MIN_GATEWAY_TICKET_RAW_BYTES,
    }),
    gatewayTicketTtlMilliseconds: readInteger(env, "REALTIME_CHAT_GATEWAY_TICKET_TTL_MS", 60_000, {
      min: 1_000,
    }),
    gatewayUrl,
    internalTransportSecurity,
    logLevel: readOptionalString(env, "LOG_LEVEL", "info"),
    nodeEnvironment,
    port: readInteger(env, "PORT", 3000, {
      max: 65_535,
      min: 1,
    }),
    requestTimeoutMilliseconds: readInteger(env, "REALTIME_CHAT_REQUEST_TIMEOUT_MS", 10_000, {
      min: 100,
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

function readActorAuthSecurity(env: NodeJS.ProcessEnv): RealtimeChatApiConfig["actorAuthSecurity"] {
  const value = readOptionalString(env, "REALTIME_CHAT_ACTOR_AUTH_SECURITY", "development");

  if (value === "development" || value === "trusted-edge") {
    return value;
  }

  throw new Error("REALTIME_CHAT_ACTOR_AUTH_SECURITY must be development or trusted-edge");
}

function readCorsAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const rawValue = readOptionalString(
    env,
    "REALTIME_CHAT_CORS_ALLOWED_ORIGINS",
    "http://localhost:5173",
  );
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
  const value = readOptionalString(env, "NODE_ENV", "development");

  if (value === "development" || value === "production" || value === "test") {
    return value;
  }

  throw new Error("NODE_ENV must be development, production, or test");
}

function readInternalTransportSecurity(
  env: NodeJS.ProcessEnv,
): RealtimeChatApiConfig["internalTransportSecurity"] {
  const value = readOptionalString(env, "REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY", "development");

  if (value === "development" || value === "direct-tls" || value === "service-mesh-tls") {
    return value;
  }

  throw new Error(
    "REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY must be development, direct-tls, or service-mesh-tls",
  );
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
