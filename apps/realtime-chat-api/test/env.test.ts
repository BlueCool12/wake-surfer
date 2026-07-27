import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import {
  MAX_GATEWAY_TICKET_RAW_BYTES,
  MIN_GATEWAY_TICKET_RAW_BYTES,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

const REQUIRED_SETTING_NAMES = [
  "HOST",
  "LOG_LEVEL",
  "NODE_ENV",
  "PORT",
  "REALTIME_CHAT_ACTOR_AUTH_SECURITY",
  "REALTIME_CHAT_ACTOR_ID_HEADER",
  "REALTIME_CHAT_CORS_ALLOWED_ORIGINS",
  "REALTIME_CHAT_DATABASE_URL",
  "REALTIME_CHAT_GATEWAY_API_TOKEN",
  "REALTIME_CHAT_GATEWAY_ASSERTED_ACTOR_HEADER",
  "REALTIME_CHAT_GATEWAY_ID",
  "REALTIME_CHAT_GATEWAY_ID_HEADER",
  "REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES",
  "REALTIME_CHAT_GATEWAY_TICKET_TTL_MS",
  "REALTIME_CHAT_GATEWAY_URL",
  "REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS",
  "REALTIME_CHAT_HTTP_KEEP_ALIVE_TIMEOUT_MS",
  "REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS",
  "REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY",
  "REALTIME_CHAT_OPERATION_ABORT_MS",
  "REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS",
  "REALTIME_CHAT_POSTGRES_IDLE_TIMEOUT_MS",
  "REALTIME_CHAT_POSTGRES_MAX_LIFETIME_SECONDS",
  "REALTIME_CHAT_POSTGRES_POOL_MAX",
  "REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS",
  "REALTIME_CHAT_REQUEST_TIMEOUT_MS",
  "REALTIME_CHAT_SHUTDOWN_GRACE_MS",
] as const;

describe("realtime chat API runtime configuration", () => {
  it("loads the checked-in team-internal runtime configuration", () => {
    expect(loadEnv(teamInternalExampleEnv())).toMatchObject({
      host: "127.0.0.1",
      httpHeadersTimeoutMilliseconds: 5_000,
      httpKeepAliveTimeoutMilliseconds: 5_000,
      httpRequestTimeoutMilliseconds: 12_000,
      operationAbortMilliseconds: 8_000,
      postgresPool: {
        connectionTimeoutMillis: 2_000,
        statementTimeoutMillis: 5_000,
      },
      requestTimeoutMilliseconds: 10_000,
      shutdownGraceMilliseconds: 10_000,
    });
  });

  it.each(REQUIRED_SETTING_NAMES)("fails startup when %s is missing", (name) => {
    const env = requiredEnv();
    delete env[name];

    expect(() => loadEnv(env)).toThrow(new RegExp(`${name} is required`));
  });

  it("rejects unsupported log levels during configuration parsing", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        LOG_LEVEL: "verbose",
      }),
    ).toThrow(/LOG_LEVEL/);
  });

  it("rejects the retired configurable request body setting", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_REQUEST_BODY_LIMIT_BYTES: "65536",
      }),
    ).toThrow(/REALTIME_CHAT_REQUEST_BODY_LIMIT_BYTES is no longer supported/);
  });

  it.each([
    "REALTIME_CHAT_ACTOR_ID_HEADER",
    "REALTIME_CHAT_GATEWAY_ASSERTED_ACTOR_HEADER",
    "REALTIME_CHAT_GATEWAY_ID_HEADER",
  ] as const)("rejects an invalid HTTP header name in %s", (name) => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        [name]: "invalid header",
      }),
    ).toThrow(/valid HTTP header name/);
  });

  it("validates response-work and slow-client budgets within their own layers", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_OPERATION_ABORT_MS: "10000",
        REALTIME_CHAT_REQUEST_TIMEOUT_MS: "10000",
      }),
    ).toThrow(/OPERATION_ABORT_MS/);

    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS: "6000",
      }),
    ).toThrow(/leave time/);

    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS: "13000",
      }),
    ).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);
  });

  it.each([MIN_GATEWAY_TICKET_RAW_BYTES, MAX_GATEWAY_TICKET_RAW_BYTES])(
    "accepts gateway ticket raw byte boundary %i",
    (gatewayTicketRawBytes) => {
      expect(
        loadEnv({
          ...requiredEnv(),
          REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES: String(gatewayTicketRawBytes),
        }).gatewayTicketRawBytes,
      ).toBe(gatewayTicketRawBytes);
    },
  );

  it("rejects gateway ticket raw bytes above the policy maximum", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES: String(MAX_GATEWAY_TICKET_RAW_BYTES + 1),
      }),
    ).toThrow(/REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES/);
  });

  it("requires a Gateway service token with at least 32 UTF-8 bytes", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_API_TOKEN: "short-token",
      }),
    ).toThrow(/32 UTF-8 bytes/);
  });

  it("requires the Hono Bearer token character policy", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_API_TOKEN: `${"a".repeat(31)}:`,
      }),
    ).toThrow(/RFC 6750 Bearer token characters/);
  });

  it("requires an explicit TLS proof in production", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        NODE_ENV: "production",
      }),
    ).toThrow(/TLS/);

    expect(
      loadEnv({
        ...requiredEnv(),
        NODE_ENV: "production",
        REALTIME_CHAT_ACTOR_AUTH_SECURITY: "trusted-edge",
        REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY: "service-mesh-tls",
        REALTIME_CHAT_GATEWAY_URL: "wss://gateway.example.test/realtime-chat",
      }).internalTransportSecurity,
    ).toBe("service-mesh-tls");
  });

  it("requires an explicit trusted actor edge and WSS Gateway URL in production", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        NODE_ENV: "production",
        REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY: "direct-tls",
        REALTIME_CHAT_GATEWAY_URL: "wss://gateway.example.test/realtime-chat",
      }),
    ).toThrow(/ACTOR_AUTH_SECURITY/);

    expect(() =>
      loadEnv({
        ...requiredEnv(),
        NODE_ENV: "production",
        REALTIME_CHAT_ACTOR_AUTH_SECURITY: "trusted-edge",
        REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY: "direct-tls",
      }),
    ).toThrow(/must use wss/);
  });

  it("parses only explicit HTTP CORS origins", () => {
    expect(
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_CORS_ALLOWED_ORIGINS:
          "https://web.example.test,http://localhost:5173,https://web.example.test",
      }).corsAllowedOrigins,
    ).toEqual(["https://web.example.test", "http://localhost:5173"]);

    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_CORS_ALLOWED_ORIGINS: "https://web.example.test/path",
      }),
    ).toThrow(/origins/);
  });
});

function teamInternalExampleEnv(): NodeJS.ProcessEnv {
  return parseEnv(
    readFileSync(new URL("../.env.example", import.meta.url), {
      encoding: "utf8",
    }),
  );
}

function requiredEnv(): NodeJS.ProcessEnv {
  return {
    HOST: "127.0.0.1",
    LOG_LEVEL: "info",
    NODE_ENV: "development",
    PORT: "3000",
    REALTIME_CHAT_ACTOR_AUTH_SECURITY: "development",
    REALTIME_CHAT_ACTOR_ID_HEADER: "x-actor-id",
    REALTIME_CHAT_CORS_ALLOWED_ORIGINS: "http://localhost:5173",
    REALTIME_CHAT_DATABASE_URL: "postgres://localhost/wake_surfer",
    REALTIME_CHAT_GATEWAY_API_TOKEN: "a".repeat(32),
    REALTIME_CHAT_GATEWAY_ASSERTED_ACTOR_HEADER: "x-realtime-chat-actor-id",
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
    REALTIME_CHAT_GATEWAY_ID_HEADER: "x-gateway-id",
    REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES: "32",
    REALTIME_CHAT_GATEWAY_TICKET_TTL_MS: "60000",
    REALTIME_CHAT_GATEWAY_URL: "ws://localhost:3001/realtime-chat",
    REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS: "5000",
    REALTIME_CHAT_HTTP_KEEP_ALIVE_TIMEOUT_MS: "5000",
    REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS: "12000",
    REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY: "development",
    REALTIME_CHAT_OPERATION_ABORT_MS: "8000",
    REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS: "2000",
    REALTIME_CHAT_POSTGRES_IDLE_TIMEOUT_MS: "30000",
    REALTIME_CHAT_POSTGRES_MAX_LIFETIME_SECONDS: "300",
    REALTIME_CHAT_POSTGRES_POOL_MAX: "10",
    REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS: "5000",
    REALTIME_CHAT_REQUEST_TIMEOUT_MS: "10000",
    REALTIME_CHAT_SHUTDOWN_GRACE_MS: "10000",
  };
}
