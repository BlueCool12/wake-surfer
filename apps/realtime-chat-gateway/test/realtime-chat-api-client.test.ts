import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayTicketApiClient } from "../src/runtime/realtime-chat-api-client.js";

describe("realtime chat API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("propagates request ID and cancellation signal without exposing the ticket in the URL", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "consumed",
        ticket: {
          actorId: "actor-1",
          consumedAt: "2026-07-12T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createGatewayTicketApiClient({
      apiBaseUrl: "http://api.example.com/",
      gatewayIdHeader: "x-gateway-id",
    });
    const abortController = new AbortController();

    await client.consumeGatewayTicket({
      gatewayId: "gateway-1",
      requestId: "gateway-request_1",
      signal: abortController.signal,
      ticket: "secret-ticket",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.example.com/internal/realtime-chat/gateway-tickets/consume",
      expect.objectContaining({
        body: JSON.stringify({ ticket: "secret-ticket" }),
        headers: expect.objectContaining({
          "x-gateway-id": "gateway-1",
          "x-request-id": "gateway-request_1",
        }),
        signal: abortController.signal,
      }),
    );
  });

  it("rejects a semantically invalid consumed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "consumed",
          ticket: {
            actorId: " ",
            consumedAt: "not-a-date",
          },
        }),
      ),
    );
    const client = createGatewayTicketApiClient({
      apiBaseUrl: "http://127.0.0.1:3000",
      gatewayIdHeader: "x-gateway-id",
    });

    await expect(
      client.consumeGatewayTicket({
        gatewayId: "gateway-1",
        requestId: "gateway-request_1",
        signal: new AbortController().signal,
        ticket: "ticket-1",
      }),
    ).rejects.toThrow("응답 형식");
  });
});
