import { describe, expect, it } from "vitest";

import { createHeaderAuthContext } from "../src/runtime/auth-context.js";

const SERVICE_TOKEN = "gateway-service-token-with-32-bytes";

describe("realtime chat API trusted auth context", () => {
  const auth = createHeaderAuthContext({
    actorIdHeader: "x-actor-id",
    gatewayApiToken: SERVICE_TOKEN,
    gatewayAssertedActorHeader: "x-realtime-chat-actor-id",
    gatewayId: "gateway-1",
    gatewayIdHeader: "x-gateway-id",
  });

  it("authenticates a Gateway only with both bearer credential and configured identity", () => {
    expect(
      auth.authenticateGateway(
        createRequest({
          authorization: `Bearer ${SERVICE_TOKEN}`,
          "x-gateway-id": "gateway-1",
        }),
      ),
    ).toEqual({ gatewayId: "gateway-1" });

    expect(() =>
      auth.authenticateGateway(
        createRequest({
          authorization: "Bearer wrong-service-token-with-32-bytes",
          "x-gateway-id": "gateway-1",
        }),
      ),
    ).toThrow(/credential/);
    expect(() =>
      auth.authenticateGateway(
        createRequest({
          authorization: `Bearer ${SERVICE_TOKEN}`,
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
