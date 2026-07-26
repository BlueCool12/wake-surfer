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
        port: 3001,
      }),
    );
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
