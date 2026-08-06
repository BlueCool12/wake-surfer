import { describe, expect, it, vi } from "vitest";

import { createGatewayApiClient } from "../src/runtime/gateway-api-client.js";

describe("gateway API client", () => {
  it("authenticates ticket consumption and asserted-actor message send requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "consumed",
            ticket: {
              actorId: "actor-1",
              consumedAt: "2026-07-25T00:00:00.000Z",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "accepted",
            idempotencyKey: "client-message-1",
            message: {
              messageId: "message-1",
              streamId: "channel:room-1",
              sequence: 1,
              senderActorId: "actor-1",
              target: { type: "channel", channelId: "room-1" },
              text: "hello",
              createdAt: "2026-07-25T00:00:01.000Z",
            },
          }),
          { status: 200 },
        ),
      );
    const client = createGatewayApiClient({
      actorHeader: "x-realtime-chat-actor-id",
      apiBaseUrl: "http://api.example/",
      fetch: fetchMock,
      gatewayApiToken: "test-token-that-is-at-least-32-bytes",
      gatewayId: "gateway-1",
      gatewayIdHeader: "x-gateway-id",
      timeoutMilliseconds: 1_000,
    });
    const controller = new AbortController();

    await client.consumeGatewayTicket({
      requestId: "request-ticket",
      signal: controller.signal,
      ticket: "ticket-1",
    });
    await client.sendMessage(
      {
        idempotencyKey: "client-message-1",
        target: { type: "channel", channelId: "room-1" },
        text: "hello",
      },
      {
        actorId: "actor-1",
        requestId: "request-message",
        signal: controller.signal,
      },
    );

    const ticketRequest = fetchMock.mock.calls[0]!;
    expect(String(ticketRequest[0])).toBe(
      "http://api.example/internal/realtime-chat/gateway-tickets/consume",
    );
    expect(new Headers(ticketRequest[1]?.headers)).toEqual(
      expect.objectContaining({
        get: expect.any(Function),
      }),
    );
    expect(new Headers(ticketRequest[1]?.headers).get("authorization")).toBe(
      "Bearer test-token-that-is-at-least-32-bytes",
    );
    expect(new Headers(ticketRequest[1]?.headers).get("x-gateway-id")).toBe("gateway-1");

    const messageRequest = fetchMock.mock.calls[1]!;
    expect(String(messageRequest[0])).toBe("http://api.example/internal/realtime-chat/messages");
    expect(new Headers(messageRequest[1]?.headers).get("authorization")).toBe(
      "Bearer test-token-that-is-at-least-32-bytes",
    );
    expect(new Headers(messageRequest[1]?.headers).get("x-gateway-id")).toBe("gateway-1");
    expect(new Headers(messageRequest[1]?.headers).get("x-realtime-chat-actor-id")).toBe("actor-1");
  });
});
