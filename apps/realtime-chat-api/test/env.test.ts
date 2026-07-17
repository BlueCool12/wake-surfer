import {
  MAX_GATEWAY_TICKET_RAW_BYTES,
  MIN_GATEWAY_TICKET_RAW_BYTES,
} from "@wake-surfer/realtime-chat-gateway-ticket";
import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("realtime chat API runtime configuration", () => {
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
});

function requiredEnv(): NodeJS.ProcessEnv {
  return {
    REALTIME_CHAT_DATABASE_URL: "postgres://localhost/wake_surfer",
    REALTIME_CHAT_GATEWAY_ID: "gateway-1",
    REALTIME_CHAT_GATEWAY_URL: "ws://localhost:3001/realtime-chat",
  };
}
