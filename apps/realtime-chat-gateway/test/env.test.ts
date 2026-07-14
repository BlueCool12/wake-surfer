import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("realtime chat gateway runtime configuration", () => {
  it("loads deployment safety defaults", () => {
    const config = loadEnv(requiredEnv());

    expect(config).toMatchObject({
      allowedOrigins: [],
      apiRequestTimeoutMilliseconds: 6_000,
      heartbeatIntervalMilliseconds: 30_000,
      maxConnections: 10_000,
      maxPendingAuthentications: 256,
      shutdownGraceMilliseconds: 10_000,
    });
  });

  it("requires the HTTP headers timeout not to exceed the request timeout", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS: "10001",
        REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS: "10000",
      }),
    ).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);
  });
});

function requiredEnv(): NodeJS.ProcessEnv {
  return {
    REALTIME_CHAT_API_BASE_URL: "http://localhost:3000",
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
  };
}
