import {
  MAX_GATEWAY_TICKET_RAW_BYTES,
  MIN_GATEWAY_TICKET_RAW_BYTES,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("realtime chat API runtime configuration", () => {
  it("loads bounded runtime defaults", () => {
    expect(loadEnv(requiredEnv())).toMatchObject({
      httpHeadersTimeoutMilliseconds: 5_000,
      httpKeepAliveTimeoutMilliseconds: 5_000,
      httpRequestTimeoutMilliseconds: 12_000,
      operationAbortMilliseconds: 8_000,
      postgresPool: {
        connectionTimeoutMillis: 2_000,
        statementTimeoutMillis: 5_000,
      },
      requestBodyLimitBytes: 16_384,
      requestTimeoutMilliseconds: 10_000,
      shutdownGraceMilliseconds: 10_000,
    });
  });

  it("requires database, operation, Hono, and HTTP budgets to remain nested", () => {
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
        REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS: "10000",
        REALTIME_CHAT_REQUEST_TIMEOUT_MS: "10000",
      }),
    ).toThrow(/REQUEST_TIMEOUT_MS/);

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

function requiredEnv(): NodeJS.ProcessEnv {
  return {
    REALTIME_CHAT_DATABASE_URL: "postgres://localhost/wake_surfer",
    REALTIME_CHAT_GATEWAY_API_TOKEN: "a".repeat(32),
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
    REALTIME_CHAT_GATEWAY_URL: "ws://localhost:3001/realtime-chat",
  };
}
