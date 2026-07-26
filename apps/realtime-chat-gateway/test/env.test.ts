import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("realtime chat gateway env", () => {
  it("loads the development MVP defaults", () => {
    const config = loadEnv({
      REALTIME_CHAT_API_BASE_URL: "http://localhost:3000",
      REALTIME_CHAT_GATEWAY_API_TOKEN: "test-token-that-is-at-least-32-bytes",
      REALTIME_CHAT_GATEWAY_ID: "gateway-1",
    });

    expect(config).toEqual(
      expect.objectContaining({
        allowedOrigins: ["http://localhost:5173"],
        apiBaseUrl: "http://localhost:3000/",
        gatewayId: "gateway-1",
        gatewayPath: "/realtime-chat",
        heartbeatIntervalMilliseconds: 30_000,
        httpHeadersTimeoutMilliseconds: 5_000,
        httpKeepAliveTimeoutMilliseconds: 5_000,
        httpRequestTimeoutMilliseconds: 10_000,
        maxConnections: 10_000,
        maxPendingAuthentications: 256,
        port: 3001,
      }),
    );
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
        NODE_ENV: "production",
        REALTIME_CHAT_API_BASE_URL: "http://localhost:3000",
        REALTIME_CHAT_GATEWAY_API_TOKEN: "test-token-that-is-at-least-32-bytes",
        REALTIME_CHAT_GATEWAY_ID: "gateway-1",
      }),
    ).toThrow("production requires REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY");
  });
});

function requiredEnv(): NodeJS.ProcessEnv {
  return {
    REALTIME_CHAT_API_BASE_URL: "http://localhost:3000",
    REALTIME_CHAT_GATEWAY_API_TOKEN: "test-token-that-is-at-least-32-bytes",
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
  };
}
