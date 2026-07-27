import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";
import { MAX_INBOUND_WEBSOCKET_PAYLOAD_BYTES } from "../src/config/runtime-policy.js";

describe("realtime chat gateway env", () => {
  it("loads the checked-in team-internal profile", () => {
    const config = loadEnv(teamInternalExampleEnv());

    expect(config).toEqual(
      expect.objectContaining({
        allowedOrigins: ["http://localhost:5173"],
        apiBaseUrl: "http://localhost:3000/",
        apiRequestTimeoutMilliseconds: 12_000,
        gatewayId: "gateway-1",
        gatewayPath: "/realtime-chat",
        heartbeatIntervalMilliseconds: 30_000,
        httpHeadersTimeoutMilliseconds: 5_000,
        httpKeepAliveTimeoutMilliseconds: 5_000,
        httpRequestTimeoutMilliseconds: 10_000,
        maxConnections: 32,
        maxPendingAuthentications: 8,
        port: 3001,
      }),
    );
    expect(MAX_INBOUND_WEBSOCKET_PAYLOAD_BYTES).toBe(65_536);
  });

  it("rejects every missing runtime setting instead of applying a fallback", () => {
    for (const name of Object.keys(requiredEnv())) {
      const env = requiredEnv();
      delete env[name];

      expect(() => loadEnv(env)).toThrow(`${name} is required`);
    }
  });

  it("rejects invalid HTTP and connection capacity relationships", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS: "10001",
        REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS: "10000",
      }),
    ).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);

    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS: "10",
        REALTIME_CHAT_GATEWAY_MAX_PENDING_AUTHENTICATIONS: "11",
      }),
    ).toThrow(/MAX_PENDING_AUTHENTICATIONS/);
  });

  it("rejects an insecure production internal transport", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        NODE_ENV: "production",
      }),
    ).toThrow("production requires REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY");
  });

  it("rejects an unsupported log level during configuration parsing", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        LOG_LEVEL: "verbose",
      }),
    ).toThrow(/LOG_LEVEL/);
  });

  it("rejects integers outside JavaScript's safe range", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS: "9007199254740992",
      }),
    ).toThrow("REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS must be a safe integer");
  });

  it("rejects the retired configurable payload setting", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_MAX_PAYLOAD_BYTES: "65536",
      }),
    ).toThrow(/REALTIME_CHAT_GATEWAY_MAX_PAYLOAD_BYTES is no longer supported/);
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
    PORT: "3001",
    REALTIME_CHAT_API_ASSERTED_ACTOR_HEADER: "x-realtime-chat-actor-id",
    REALTIME_CHAT_API_BASE_URL: "http://localhost:3000",
    REALTIME_CHAT_API_GATEWAY_ID_HEADER: "x-gateway-id",
    REALTIME_CHAT_API_REQUEST_TIMEOUT_MS: "12000",
    REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS: "http://localhost:5173",
    REALTIME_CHAT_GATEWAY_API_TOKEN: "test-token-that-is-at-least-32-bytes",
    REALTIME_CHAT_GATEWAY_HEARTBEAT_INTERVAL_MS: "30000",
    REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS: "5000",
    REALTIME_CHAT_GATEWAY_HTTP_KEEP_ALIVE_TIMEOUT_MS: "5000",
    REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS: "10000",
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
    REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS: "32",
    REALTIME_CHAT_GATEWAY_MAX_PENDING_AUTHENTICATIONS: "8",
    REALTIME_CHAT_GATEWAY_PATH: "/realtime-chat",
    REALTIME_CHAT_GATEWAY_SHUTDOWN_GRACE_MS: "5000",
    REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY: "development",
  };
}
