import { describe, expect, it, vi } from "vitest";

import { createBrowserRealtimeEventSocket, type BrowserWebSocketFactory } from "../src/index.js";

describe("browser realtime event socket", () => {
  it("uses the one-time ticket and translates flat typed JSON frames", () => {
    const webSocket = new FakeWebSocket();
    const createWebSocket = vi.fn<BrowserWebSocketFactory>(() => webSocket);
    const socket = createBrowserRealtimeEventSocket({
      clientConnectionGeneration: "client-generation-1",
      createWebSocket,
      gatewayUrl: "wss://gateway.example.test/realtime-chat?region=kr",
      ticket: "ticket value",
    });
    const connected = vi.fn();
    socket.on("gateway.connected", connected);

    socket.connect();

    expect(createWebSocket).toHaveBeenCalledWith(
      "wss://gateway.example.test/realtime-chat?region=kr&ticket=ticket+value",
    );

    webSocket.serverMessage({
      type: "gateway.connected",
      protocolVersion: 1,
      connectionGeneration: "server-generation-1",
    });
    expect(connected).toHaveBeenCalledWith(
      JSON.stringify({
        protocolVersion: 1,
        connectionGeneration: "server-generation-1",
      }),
    );

    socket.emit(
      "chat.stream.sync",
      JSON.stringify({ requestId: "request-1", channelId: "channel-1", afterSequence: 0 }),
    );
    expect(webSocket.sent).toEqual([
      JSON.stringify({
        type: "chat.stream.sync",
        requestId: "request-1",
        channelId: "channel-1",
        afterSequence: 0,
      }),
    ]);
  });

  it("rejects malformed, binary, and type-overriding frames", () => {
    const webSocket = new FakeWebSocket();
    const socket = createBrowserRealtimeEventSocket({
      clientConnectionGeneration: "client-generation-1",
      createWebSocket: () => webSocket,
      gatewayUrl: "ws://localhost:3001/realtime-chat",
      ticket: "ticket-1",
    });
    socket.connect();

    webSocket.serverRawMessage("{");
    expect(webSocket.closeCalls.at(-1)).toEqual({
      code: 1008,
      reason: "invalid realtime event frame",
    });

    webSocket.serverRawMessage(new Uint8Array([1, 2, 3]));
    expect(webSocket.closeCalls.at(-1)).toEqual({
      code: 1003,
      reason: "text JSON frames are required",
    });

    expect(() =>
      socket.emit("chat.message.send", JSON.stringify({ type: "gateway.connected" })),
    ).toThrow(TypeError);
  });
});

class FakeWebSocket {
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly sent: string[] = [];
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readyState = 1;

  close(code?: number, reason?: string): void {
    this.closeCalls.push({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  serverMessage(value: Record<string, unknown>): void {
    this.serverRawMessage(JSON.stringify(value));
  }

  serverRawMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
}
