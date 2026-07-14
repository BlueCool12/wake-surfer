import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("realtime chat API runtime configuration", () => {
  it("loads deployment safety defaults", () => {
    const config = loadEnv(requiredEnv());

    expect(config).toMatchObject({
      corsOrigins: [],
      handlerTimeoutMilliseconds: 5_000,
      httpHeadersTimeoutMilliseconds: 5_000,
      httpKeepAliveTimeoutMilliseconds: 5_000,
      httpRequestTimeoutMilliseconds: 10_000,
      postgresPool: {
        statementTimeoutMillis: 2_000,
      },
      requestBodyLimitBytes: 16_384,
      shutdownGraceMilliseconds: 10_000,
    });
  });

  it("requires the handler timeout to be shorter than the HTTP request timeout", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_HANDLER_TIMEOUT_MS: "10000",
        REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS: "10000",
      }),
    ).toThrow(/HANDLER_TIMEOUT_MS/);
  });

  it("requires the PostgreSQL statement timeout to leave time for an HTTP response", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_HANDLER_TIMEOUT_MS: "5000",
        REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS: "5000",
      }),
    ).toThrow(/STATEMENT_TIMEOUT_MS/);
  });

  it("reserves handler time for pool acquisition and statement execution", () => {
    expect(() =>
      loadEnv({
        ...requiredEnv(),
        REALTIME_CHAT_HANDLER_TIMEOUT_MS: "5000",
        REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS: "3000",
        REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS: "2000",
      }),
    ).toThrow(/leave time/);
  });
});

function requiredEnv(): NodeJS.ProcessEnv {
  return {
    REALTIME_CHAT_DATABASE_URL: "postgres://localhost/wake_surfer",
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
    REALTIME_CHAT_GATEWAY_URL: "ws://localhost:3001/realtime-chat",
  };
}
