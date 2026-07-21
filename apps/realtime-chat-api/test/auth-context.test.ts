import { describe, expect, it } from "vitest";

import { createHeaderAuthContext } from "../src/runtime/auth-context.js";

describe("realtime chat API trusted auth context", () => {
  const auth = createHeaderAuthContext({
    actorIdHeader: "x-actor-id",
    gatewayAssertedActorHeader: "x-realtime-chat-actor-id",
    gatewayId: "gateway-1",
    gatewayIdHeader: "x-gateway-id",
  });

  it("accepts only the configured Gateway identity after service credential authentication", () => {
    expect(
      auth.authenticateGateway(
        createRequest({
          "x-gateway-id": "gateway-1",
        }),
      ),
    ).toEqual({ gatewayId: "gateway-1" });

    expect(() => auth.authenticateGateway(createRequest({}))).toThrow(/gateway context/);
    expect(() =>
      auth.authenticateGateway(
        createRequest({
          "x-gateway-id": "gateway-2",
        }),
      ),
    ).toThrow(/not allowed/);
  });

  it("reads the asserted actor from its server-only header", () => {
    expect(
      auth.getAssertedActor(
        createRequest({
          "x-realtime-chat-actor-id": "actor-asserted",
        }),
      ),
    ).toEqual({ actorId: "actor-asserted" });

    expect(() => auth.getAssertedActor(createRequest({}))).toThrow(/asserted gateway actor/);
  });
});

function createRequest(headers: Record<string, string>): Request {
  return new Request("https://api.example.test/internal/realtime-chat", { headers });
}
