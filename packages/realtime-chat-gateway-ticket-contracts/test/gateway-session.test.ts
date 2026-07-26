import { describe, expect, it } from "vitest";

import {
  GatewayConnectedEventSchema,
  GatewayNotReadyEventSchema,
  REALTIME_CHAT_PROTOCOL_VERSION,
} from "../src/index";

describe("Gateway session contracts", () => {
  it("accepts a credential-free authenticated connection event", () => {
    expect(
      GatewayConnectedEventSchema.parse({
        protocolVersion: REALTIME_CHAT_PROTOCOL_VERSION,
        connectionGeneration: "generation-2",
        gatewayId: "gateway-1",
        sessionId: "session-1",
        connectedAt: "2026-07-18T00:00:00.000Z",
      }),
    ).toEqual({
      protocolVersion: 1,
      connectionGeneration: "generation-2",
      gatewayId: "gateway-1",
      sessionId: "session-1",
      connectedAt: "2026-07-18T00:00:00.000Z",
    });
  });

  it("rejects actor credentials, unknown fields, and invalid connection metadata", () => {
    expect(
      GatewayConnectedEventSchema.safeParse({
        protocolVersion: 1,
        connectionGeneration: "generation-1",
        gatewayId: "gateway-1",
        sessionId: "session-1",
        connectedAt: "2026-07-18T00:00:00.000Z",
        actorId: "actor-must-not-leak",
      }).success,
    ).toBe(false);
    expect(
      GatewayConnectedEventSchema.safeParse({
        protocolVersion: 2,
        connectionGeneration: " ",
        gatewayId: "gateway-1",
        sessionId: "session-1",
        connectedAt: "not-a-date",
      }).success,
    ).toBe(false);
  });

  it("owns the pre-ready rejection payload", () => {
    expect(GatewayNotReadyEventSchema.parse({ code: "gateway.not_ready" })).toEqual({
      code: "gateway.not_ready",
    });
    expect(
      GatewayNotReadyEventSchema.safeParse({
        code: "gateway.not_ready",
        queued: true,
      }).success,
    ).toBe(false);
  });
});
