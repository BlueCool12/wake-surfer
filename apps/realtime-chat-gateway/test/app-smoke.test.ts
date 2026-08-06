import type { AddressInfo } from "node:net";

import type { GatewayStreamMessagesApiClient } from "@wake-surfer/realtime-chat-stream-messages-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";

import { createRealtimeChatGatewayApp, type RealtimeChatGatewayApp } from "../src/app.js";

import type { RealtimeChatGatewayConfig } from "../src/config/env.js";
import type { GatewayApiClient } from "../src/runtime/gateway-api-client.js";
import type { AppLogger } from "../src/runtime/logger.js";

describe("realtime chat gateway app", () => {
  it("serves health and rejects an invalid WebSocket origin or path", async () => {
    const fixture = await createFixture();
    const health = await fetch(`${fixture.httpUrl}/health`);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
    await expect(
      rejectedUpgradeStatus(`${fixture.websocketUrl}?ticket=ticket-a`, "http://evil.example"),
    ).resolves.toBe(403);
    await expect(
      rejectedUpgradeStatus(
        fixture.websocketUrl.replace("/realtime-chat", "/wrong-path") + "?ticket=ticket-a",
        "http://localhost:5173",
      ),
    ).resolves.toBe(404);
    expect(fixture.gatewayApiClient.consumeGatewayTicket).not.toHaveBeenCalled();
  });

  it("consumes the query ticket and announces the latest gateway.connected contract", async () => {
    const fixture = await createFixture();
    const connection = await connectClient(fixture.websocketUrl, "ticket-a");

    expect(connection.connected).toEqual({
      type: "gateway.connected",
      protocolVersion: 1,
      connectionGeneration: expect.stringMatching(/^gateway-connection_/),
      gatewayId: "gateway-1",
      sessionId: expect.stringMatching(/^gateway-session_/),
      connectedAt: expect.any(String),
    });
    expect(fixture.gatewayApiClient.consumeGatewayTicket).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^gateway-request_/),
      signal: expect.any(AbortSignal),
      ticket: "ticket-a",
    });
    expect(fixture.app.sessionCount()).toBe(1);
  });

  it("closes an unauthenticated socket with the application authentication code", async () => {
    const fixture = await createFixture();
    const socket = new WebSocket(fixture.websocketUrl, {
      origin: "http://localhost:5173",
    });

    await expect(waitForClose(socket)).resolves.toEqual({
      code: 4401,
      reason: "gateway ticket required",
    });
    expect(fixture.gatewayApiClient.consumeGatewayTicket).not.toHaveBeenCalled();
  });

  it("relays message send and fans out the created message to ready channel subscribers", async () => {
    const fixture = await createFixture();
    const first = await connectClient(fixture.websocketUrl, "ticket-a");
    const second = await connectClient(fixture.websocketUrl, "ticket-b");
    first.socket.send(JSON.stringify({ type: "chat.channel.join", channelId: "room-1" }));
    second.socket.send(JSON.stringify({ type: "chat.channel.join", channelId: "room-1" }));
    await waitForSocketTurn();

    const accepted = waitForFrame(first.socket, "chat.message.accepted");
    const firstCreated = waitForFrame(first.socket, "chat.message.created");
    const secondCreated = waitForFrame(second.socket, "chat.message.created");
    first.socket.send(
      JSON.stringify({
        type: "chat.message.send",
        idempotencyKey: "client-message-1",
        target: { type: "channel", channelId: "room-1" },
        text: "안녕하세요",
      }),
    );

    await expect(accepted).resolves.toEqual(
      expect.objectContaining({
        type: "chat.message.accepted",
        status: "accepted",
        idempotencyKey: "client-message-1",
      }),
    );
    const expectedMessage = expect.objectContaining({
      type: "chat.message.created",
      messageId: "message-1",
      streamId: "channel:room-1",
      sequence: 1,
      senderActorId: "actor-ticket-a",
    });
    await expect(firstCreated).resolves.toEqual(expectedMessage);
    await expect(secondCreated).resolves.toEqual(expectedMessage);
    expect(fixture.gatewayApiClient.sendMessage).toHaveBeenCalledWith(
      {
        idempotencyKey: "client-message-1",
        target: { type: "channel", channelId: "room-1" },
        text: "안녕하세요",
      },
      {
        actorId: "actor-ticket-a",
        requestId: expect.stringMatching(/^gateway-request_/),
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("relays an idempotency conflict as a correlated command rejection", async () => {
    const fixture = await createFixture();
    vi.mocked(fixture.gatewayApiClient.sendMessage).mockResolvedValueOnce({
      status: "rejected",
      idempotencyKey: "idempotency-conflict-1",
      reason: "idempotency_conflict",
    });
    const connection = await connectClient(fixture.websocketUrl, "ticket-a");
    connection.socket.send(JSON.stringify({ type: "chat.channel.join", channelId: "room-1" }));
    await waitForSocketTurn();

    const rejected = waitForFrame(connection.socket, "chat.message.rejected");
    connection.socket.send(
      JSON.stringify({
        type: "chat.message.send",
        idempotencyKey: "idempotency-conflict-1",
        target: { type: "channel", channelId: "room-1" },
        text: "different payload",
      }),
    );

    await expect(rejected).resolves.toEqual({
      type: "chat.message.rejected",
      status: "rejected",
      idempotencyKey: "idempotency-conflict-1",
      reason: "idempotency_conflict",
    });
  });

  it("fans out a persisted message when the sender disconnects before accepted delivery", async () => {
    const fixture = await createFixture();
    const first = await connectClient(fixture.websocketUrl, "ticket-a");
    const second = await connectClient(fixture.websocketUrl, "ticket-b");
    first.socket.send(JSON.stringify({ type: "chat.channel.join", channelId: "room-1" }));
    second.socket.send(JSON.stringify({ type: "chat.channel.join", channelId: "room-1" }));
    await waitForSocketTurn();

    let resolveSend:
      ((value: Awaited<ReturnType<GatewayApiClient["sendMessage"]>>) => void) | undefined;
    let sendSignal: AbortSignal | undefined;
    vi.mocked(fixture.gatewayApiClient.sendMessage).mockImplementationOnce(
      (_request, context) =>
        new Promise((resolve, reject) => {
          sendSignal = context.signal;
          const rejectOnAbort = (): void => {
            reject(new Error("message send aborted"));
          };
          context.signal.addEventListener("abort", rejectOnAbort, { once: true });
          resolveSend = (value) => {
            context.signal.removeEventListener("abort", rejectOnAbort);
            resolve(value);
          };
        }),
    );

    const secondCreated = waitForFrame(second.socket, "chat.message.created");
    first.socket.send(
      JSON.stringify({
        type: "chat.message.send",
        idempotencyKey: "client-message-disconnect",
        target: { type: "channel", channelId: "room-1" },
        text: "계속 전달",
      }),
    );
    await vi.waitFor(() => {
      expect(fixture.gatewayApiClient.sendMessage).toHaveBeenCalledTimes(1);
    });

    const senderClosed = waitForClose(first.socket);
    first.socket.close(1000, "sender left");
    await senderClosed;
    expect(sendSignal?.aborted).toBe(false);
    resolveSend?.({
      status: "accepted",
      idempotencyKey: "client-message-disconnect",
      message: {
        messageId: "message-disconnect",
        streamId: "channel:room-1",
        sequence: 2,
        senderActorId: "actor-ticket-a",
        target: { type: "channel", channelId: "room-1" },
        text: "계속 전달",
        createdAt: "2026-07-25T00:00:02.000Z",
      },
    });

    await expect(secondCreated).resolves.toEqual(
      expect.objectContaining({
        type: "chat.message.created",
        messageId: "message-disconnect",
        sequence: 2,
      }),
    );
  });

  it("connects chat.stream.sync to the Stream Messages gateway relay", async () => {
    const fixture = await createFixture();
    const connection = await connectClient(fixture.websocketUrl, "ticket-a");
    const synced = waitForFrame(connection.socket, "chat.stream.synced");
    connection.socket.send(
      JSON.stringify({
        type: "chat.stream.sync",
        requestId: "request-1",
        channelId: "room-1",
        afterSequence: 0,
        limit: 50,
      }),
    );

    await expect(synced).resolves.toEqual({
      type: "chat.stream.synced",
      requestId: "request-1",
      streamId: "channel:room-1",
      afterSequence: 0,
      throughSequence: 0,
      messages: [],
      nextAfterSequence: 0,
      hasMoreAfter: false,
    });
    expect(fixture.streamMessagesApiClient.syncAfter).toHaveBeenCalledWith(
      {
        channelId: "room-1",
        afterSequence: 0,
        limit: 50,
      },
      {
        actorId: "actor-ticket-a",
        requestId: "request-1",
        signal: expect.any(AbortSignal),
      },
    );
  });
});

async function createFixture(): Promise<{
  app: RealtimeChatGatewayApp;
  gatewayApiClient: GatewayApiClient;
  httpUrl: string;
  streamMessagesApiClient: GatewayStreamMessagesApiClient;
  websocketUrl: string;
}> {
  const gatewayApiClient: GatewayApiClient = {
    consumeGatewayTicket: vi.fn<GatewayApiClient["consumeGatewayTicket"]>(async ({ ticket }) => ({
      status: "consumed",
      ticket: {
        actorId: `actor-${ticket}`,
        consumedAt: "2026-07-25T00:00:00.000Z",
      },
    })),
    sendMessage: vi.fn<GatewayApiClient["sendMessage"]>(async (request, context) => ({
      status: "accepted",
      idempotencyKey: request.idempotencyKey,
      message: {
        messageId: "message-1",
        streamId: "channel:room-1",
        sequence: 1,
        senderActorId: context.actorId,
        target: request.target,
        text: request.text,
        createdAt: "2026-07-25T00:00:01.000Z",
      },
    })),
  };
  const streamMessagesApiClient: GatewayStreamMessagesApiClient = {
    syncAfter: vi.fn<GatewayStreamMessagesApiClient["syncAfter"]>(async (request) => ({
      streamId: `channel:${request.channelId}`,
      afterSequence: request.afterSequence,
      throughSequence: 0,
      messages: [],
      nextAfterSequence: 0,
      hasMoreAfter: false,
    })),
  };
  const app = createRealtimeChatGatewayApp(testConfig(), {
    gatewayApiClient,
    logger: testLogger(),
    streamMessagesApiClient,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.address() as AddressInfo;
  runningAppsForCurrentTest().push(app);
  const httpUrl = `http://127.0.0.1:${address.port}`;

  return {
    app,
    gatewayApiClient,
    httpUrl,
    streamMessagesApiClient,
    websocketUrl: `${httpUrl.replace("http:", "ws:")}/realtime-chat`,
  };
}

const appRegistry: RealtimeChatGatewayApp[] = [];

function runningAppsForCurrentTest(): RealtimeChatGatewayApp[] {
  return appRegistry;
}

afterEach(async () => {
  await Promise.all(appRegistry.splice(0).map((app) => app.close()));
});

function testConfig(): RealtimeChatGatewayConfig {
  return {
    allowedOrigins: ["http://localhost:5173"],
    apiActorHeader: "x-realtime-chat-actor-id",
    apiBaseUrl: "http://localhost:3000/",
    apiGatewayIdHeader: "x-gateway-id",
    apiRequestTimeoutMilliseconds: 1_000,
    gatewayApiToken: "test-token-that-is-at-least-32-bytes",
    gatewayId: "gateway-1",
    gatewayPath: "/realtime-chat",
    host: "127.0.0.1",
    internalTransportSecurity: "development",
    logLevel: "silent",
    maxPayloadBytes: 65_536,
    nodeEnvironment: "test",
    port: 0,
    shutdownGraceMilliseconds: 1_000,
  };
}

function testLogger(): AppLogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

async function connectClient(
  websocketUrl: string,
  ticket: string,
): Promise<{ connected: Record<string, unknown>; socket: WebSocket }> {
  const socket = new WebSocket(`${websocketUrl}?ticket=${encodeURIComponent(ticket)}`, {
    origin: "http://localhost:5173",
  });
  const connected = waitForFrame(socket, "gateway.connected");
  await waitForOpen(socket);
  return { connected: await connected, socket };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForFrame(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2_000);
    const onMessage = (data: RawData): void => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;

      if (frame.type === type) {
        cleanup();
        resolve(frame);
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error(`Socket closed while waiting for ${type}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.once("close", onClose);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
    socket.once("error", reject);
  });
}

function rejectedUpgradeStatus(url: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("error", reject);
  });
}

async function waitForSocketTurn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
