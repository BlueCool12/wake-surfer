import { describe, expect, it, vi } from "vitest";
import { mountRealtimeChatGateway } from "@wake-surfer/realtime-chat/gateway";
import {
  FakeWebSocketConnection,
  createGatewayRuntimeDeps,
  createWebSocketServerDouble,
  createdMessageEvent,
  fixedNow,
  rejectedTicket,
} from "./test-doubles";

describe("consumer Gateway mount flow", () => {
  it("WebSocket route를 등록하고 outbound delivery subscription을 시작한다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps, outboundHandlers } = createGatewayRuntimeDeps();

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
      },
      deps,
    );

    expect(ws.routes.map((route) => route.path)).toEqual(["/ws/realtime-chat"]);
    expect(deps.outboundEventBus.subscribe).toHaveBeenCalledTimes(1);
    expect(outboundHandlers).toHaveLength(1);
  });

  it("query ticket으로 접속하면 ticket consume 후 gateway.connected를 보낸다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps } = createGatewayRuntimeDeps();

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
      },
      deps,
    );

    const connection = new FakeWebSocketConnection({
      query: {
        ticket: " ticket-1 ",
      },
      headers: {
        "x-gateway-ticket": "header-ticket",
      },
    });
    await ws.findRoute("/ws/realtime-chat").onConnection(connection);

    expect(deps.gatewayTicketPort.consume).toHaveBeenCalledWith("ticket-1");
    expect(connection.sentEvents()[0]).toEqual({
      type: "gateway.connected",
      sessionId: "gateway-session-1",
      gatewayId: "gateway-1",
      connectedAt: fixedNow.toISOString(),
    });
    expect(connection.closed).toBeUndefined();
  });

  it("ticket이 없으면 gateway.connection.rejected 후 4401로 닫는다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps } = createGatewayRuntimeDeps();

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
      },
      deps,
    );

    const connection = new FakeWebSocketConnection();
    await ws.findRoute("/ws/realtime-chat").onConnection(connection);

    expect(connection.sentEvents()).toEqual([
      {
        type: "gateway.connection.rejected",
        reason: "GATEWAY_TICKET_MISSING",
      },
    ]);
    expect(connection.closed).toEqual({
      code: 4401,
      reason: "GATEWAY_TICKET_MISSING",
    });
  });

  it("ticket consume 실패 reason을 connection rejection으로 relay한다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps } = createGatewayRuntimeDeps({
      gatewayTicketPort: {
        consume: vi.fn(async () =>
          rejectedTicket("GATEWAY_TICKET_INVALID_OR_EXPIRED", "ticket expired"),
        ),
      },
    });

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
      },
      deps,
    );

    const connection = new FakeWebSocketConnection({
      headers: {
        "x-gateway-ticket": "expired-ticket",
      },
    });
    await ws.findRoute("/ws/realtime-chat").onConnection(connection);

    expect(connection.sentEvents()).toEqual([
      {
        type: "gateway.connection.rejected",
        reason: "GATEWAY_TICKET_INVALID_OR_EXPIRED",
        message: "ticket expired",
      },
    ]);
    expect(connection.closed).toEqual({
      code: 4401,
      reason: "GATEWAY_TICKET_INVALID_OR_EXPIRED",
    });
  });

  it("client channel message event를 API DTO로 mapping하고 accepted event를 relay한다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps } = createGatewayRuntimeDeps();

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
      },
      deps,
    );

    const connection = new FakeWebSocketConnection({
      query: {
        ticket: "user-1",
      },
    });
    await ws.findRoute("/ws/realtime-chat").onConnection(connection);
    await connection.receive(
      JSON.stringify({
        type: "chat.channel.message.send",
        commandId: "command-1",
        clientMessageId: "client-message-1",
        workspaceId: "workspace-1",
        channelId: "channel-1",
        content: {
          kind: "text",
          text: "안녕하세요",
        },
        sentAtClient: fixedNow.toISOString(),
      }),
    );

    expect(deps.chatApiClient.sendChannelMessage).toHaveBeenCalledWith({
      requestId: "command-1",
      actorId: "user-1",
      workspaceId: "workspace-1",
      channelId: "channel-1",
      clientMessageId: "client-message-1",
      content: {
        kind: "text",
        text: "안녕하세요",
      },
      sentAtClient: fixedNow.toISOString(),
    });
    expect(connection.sentEvents()[1]).toEqual({
      type: "chat.message.accepted",
      commandId: "command-1",
      clientMessageId: "client-message-1",
      messageId: "message-1",
      streamId: "stream-channel-1",
      sequence: 10,
      serverCreatedAt: fixedNow.toISOString(),
    });
  });

  it("malformed client payload는 gateway.error로 응답한다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps } = createGatewayRuntimeDeps();

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
      },
      deps,
    );

    const connection = new FakeWebSocketConnection({
      query: {
        ticket: "user-1",
      },
    });
    await ws.findRoute("/ws/realtime-chat").onConnection(connection);
    await connection.receive("not-json");

    expect(connection.sentEvents()[1]).toEqual({
      type: "gateway.error",
      reason: "INVALID_PAYLOAD",
      message: "payload must be valid JSON",
    });
  });

  it("maxPayloadBytes를 넘는 payload는 PAYLOAD_TOO_LARGE로 거부한다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps } = createGatewayRuntimeDeps();

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
        maxPayloadBytes: 5,
      },
      deps,
    );

    const connection = new FakeWebSocketConnection({
      query: {
        ticket: "user-1",
      },
    });
    await ws.findRoute("/ws/realtime-chat").onConnection(connection);
    await connection.receive(JSON.stringify({ type: "unknown" }));

    expect(connection.sentEvents()[1]).toEqual({
      type: "gateway.error",
      reason: "PAYLOAD_TOO_LARGE",
    });
  });

  it("outbound delivery는 recipientUserIds에 해당하는 local session에만 push한다", async () => {
    const ws = createWebSocketServerDouble();
    const { deps, outboundHandlers } = createGatewayRuntimeDeps();

    await mountRealtimeChatGateway(
      ws.server,
      {
        path: "/ws/realtime-chat",
        gatewayId: "gateway-1",
      },
      deps,
    );

    const route = ws.findRoute("/ws/realtime-chat");
    const sender = new FakeWebSocketConnection({
      query: {
        ticket: "user-1",
      },
    });
    const recipient = new FakeWebSocketConnection({
      query: {
        ticket: "user-2",
      },
    });
    await route.onConnection(sender);
    await route.onConnection(recipient);

    const payload = createdMessageEvent({
      messageId: "message-2",
      streamId: "stream-channel-1",
      sequence: 20,
      senderId: "user-1",
    });
    await outboundHandlers[0]?.({
      eventId: "event-1",
      eventType: "OutboundMessageDeliveryRequested",
      occurredAt: fixedNow.toISOString(),
      streamId: "stream-channel-1",
      streamType: "CHANNEL",
      messageId: "message-2",
      sequence: 20,
      recipientUserIds: ["user-2"],
      payload,
    });

    expect(sender.sentEvents()).toHaveLength(1);
    expect(recipient.sentEvents()[1]).toEqual(payload);
  });
});
