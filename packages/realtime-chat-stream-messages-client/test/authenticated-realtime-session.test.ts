import { describe, expect, it, vi } from "vitest";

import {
  AuthenticatedRealtimeSessionModel,
  StreamMessagesTransportError,
  createGatewayTicketHttpIssuer,
  type RealtimeEventName,
  type RealtimeEventSocket,
} from "../src/index.js";

describe("authenticated realtime session", () => {
  it("issues a credentialed ticket request and validates the response", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(JSON.stringify(ticketResponse()), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
    );
    const issuer = createGatewayTicketHttpIssuer({
      apiBaseUrl: "https://api.example.test/v1/",
      fetch: fetchImplementation,
    });

    await expect(issuer.issue({ signal: new AbortController().signal })).resolves.toEqual(
      ticketResponse(),
    );
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("https://api.example.test/v1/realtime-chat/gateway-tickets"),
      expect.objectContaining({
        body: "{}",
        credentials: "include",
        method: "POST",
      }),
    );

    const invalidIssuer = createGatewayTicketHttpIssuer({
      apiBaseUrl: "https://api.example.test/",
      fetch: vi.fn(async () => new Response(JSON.stringify({ ticket: "leaked-only" }))),
    });
    await expect(
      invalidIssuer.issue({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "protocol_failure" });

    const rejectedIssuer = createGatewayTicketHttpIssuer({
      apiBaseUrl: "https://api.example.test/",
      fetch: vi.fn(async () => new Response("{}", { status: 401 })),
    });
    await expect(
      rejectedIssuer.issue({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "ticket_rejected", retryable: false });
  });

  it("becomes ready only after gateway.connected and correlates feature responses", async () => {
    const socket = new FakeSocket();
    const session = createSession(() => socket);
    const connecting = session.connect();
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledOnce());
    expect(session.state).toBe("connecting");
    await expect(
      session.requestStreamSync(syncEvent(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "session_not_ready" });

    socket.serverEmit("gateway.connected", connectedEvent("server-generation-1"));
    await connecting;
    expect(session.state).toBe("ready");
    expect(session.connectionGeneration).toBe("server-generation-1");

    const response = session.requestStreamSync(syncEvent(), {
      signal: new AbortController().signal,
    });
    expect(socket.clientEmits.at(-1)).toEqual({
      eventName: "chat.stream.sync",
      rawPayload: JSON.stringify(syncEvent()),
    });
    const rawResponse = JSON.stringify({ requestId: "request-1", code: "stream_unavailable" });
    socket.serverEmit("chat.stream.sync.rejected", rawResponse);
    await expect(response).resolves.toBe(rawResponse);
  });

  it("reissues a ticket after close and discards events from the previous generation", async () => {
    const sockets: FakeSocket[] = [];
    const ticketIssuer = { issue: vi.fn(async () => ticketResponse()) };
    const session = createSession(
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      { ticketIssuer },
    );
    const firstConnect = session.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.serverEmit("gateway.connected", connectedEvent("server-generation-1"));
    await firstConnect;

    sockets[0]!.serverClose();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(ticketIssuer.issue).toHaveBeenCalledTimes(2);
    sockets[1]!.serverEmit("gateway.connected", connectedEvent("server-generation-2"));
    await vi.waitFor(() => expect(session.state).toBe("ready"));

    let settled = false;
    const response = session
      .requestStreamSync(syncEvent(), { signal: new AbortController().signal })
      .then((value) => {
        settled = true;
        return value;
      });
    const raw = JSON.stringify({ requestId: "request-1", code: "invalid_cursor" });
    sockets[0]!.serverEmit("chat.stream.sync.rejected", raw);
    await Promise.resolve();
    expect(settled).toBe(false);
    sockets[1]!.serverEmit("chat.stream.sync.rejected", raw);
    await expect(response).resolves.toBe(raw);
    expect(session.connectionGeneration).toBe("server-generation-2");
  });

  it("keeps application event subscriptions and sends through the current reconnect generation", async () => {
    const sockets: FakeSocket[] = [];
    const session = createSession(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const created = vi.fn();
    const unsubscribe = session.onApplicationEvent("chat.message.created", created);
    const firstConnect = session.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.serverEmit("gateway.connected", connectedEvent("server-generation-1"));
    await firstConnect;

    session.sendApplicationEvent(
      "chat.channel.join",
      JSON.stringify({ channelId: "channel-session" }),
    );
    expect(sockets[0]!.clientEmits.at(-1)).toEqual({
      eventName: "chat.channel.join",
      rawPayload: JSON.stringify({ channelId: "channel-session" }),
    });
    sockets[0]!.serverEmit("chat.message.created", JSON.stringify({ messageId: "message-1" }));
    expect(created).toHaveBeenCalledWith(JSON.stringify({ messageId: "message-1" }));

    sockets[0]!.serverClose();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.serverEmit("gateway.connected", connectedEvent("server-generation-2"));
    await vi.waitFor(() => expect(session.state).toBe("ready"));
    sockets[1]!.serverEmit("chat.message.created", JSON.stringify({ messageId: "message-2" }));
    expect(created).toHaveBeenLastCalledWith(JSON.stringify({ messageId: "message-2" }));

    unsubscribe();
    sockets[1]!.serverEmit("chat.message.created", JSON.stringify({ messageId: "message-3" }));
    expect(created).toHaveBeenCalledTimes(2);
  });

  it("retries connection with exponential backoff and aborts pending requests on logout", async () => {
    const socket = new FakeSocket();
    const delay = vi.fn(async () => undefined);
    let issueAttempts = 0;
    const session = createSession(() => socket, {
      delay,
      ticketIssuer: {
        issue: vi.fn(async () => {
          issueAttempts += 1;
          if (issueAttempts === 1) throw new Error("ticket temporarily unavailable");
          return ticketResponse();
        }),
      },
    });
    const connecting = session.connect();
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledOnce());
    expect(delay).toHaveBeenCalledWith(10, expect.any(AbortSignal));
    socket.serverEmit("gateway.connected", connectedEvent("server-generation-1"));
    await connecting;

    const pending = session.requestStreamSync(syncEvent(), {
      signal: new AbortController().signal,
    });
    session.disconnect();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(session.state).toBe("closed");
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("bounds a ticket request that ignores abort and does not retry a rejected ticket", async () => {
    const timeoutSession = createSession(() => new FakeSocket(), {
      connectedTimeoutMilliseconds: 5,
      maxImmediateRetries: 0,
      ticketIssuer: { issue: () => new Promise(() => undefined) },
    });
    await expect(timeoutSession.connect()).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });

    const rejectedIssue = vi.fn(async () => {
      throw new StreamMessagesTransportError("ticket_rejected");
    });
    const rejectedSession = createSession(() => new FakeSocket(), {
      ticketIssuer: { issue: rejectedIssue },
    });
    await expect(rejectedSession.connect()).rejects.toMatchObject({ code: "ticket_rejected" });
    expect(rejectedIssue).toHaveBeenCalledOnce();
  });
});

function createSession(
  createSocket: () => RealtimeEventSocket,
  overrides: Partial<ConstructorParameters<typeof AuthenticatedRealtimeSessionModel>[0]> = {},
) {
  return new AuthenticatedRealtimeSessionModel({
    actorSessionNamespace: "actor-session-test",
    connectedTimeoutMilliseconds: 1_000,
    createSocket,
    delay: vi.fn(async () => undefined),
    maxImmediateRetries: 2,
    reconnectBaseDelayMilliseconds: 10,
    reconnectMaxDelayMilliseconds: 40,
    ticketIssuer: { issue: vi.fn(async () => ticketResponse()) },
    ...overrides,
  });
}

class FakeSocket implements RealtimeEventSocket {
  readonly clientEmits: Array<{ eventName: string; rawPayload: string }> = [];
  readonly close = vi.fn();
  readonly connect = vi.fn();
  readonly #listeners = new Map<string, Set<(rawPayload: string) => void>>();
  readonly #closeListeners = new Set<() => void>();

  emit = (eventName: string, rawPayload: string): void => {
    this.clientEmits.push({ eventName, rawPayload });
  };

  on = (eventName: string, listener: (rawPayload: string) => void): (() => void) => {
    let listeners = this.#listeners.get(eventName);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(eventName, listeners);
    }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  };

  onClose = (listener: () => void): (() => void) => {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  };

  serverEmit(eventName: RealtimeEventName | "chat.message.created", rawPayload: string): void {
    for (const listener of this.#listeners.get(eventName) ?? []) listener(rawPayload);
  }

  serverClose(): void {
    for (const listener of [...this.#closeListeners]) listener();
  }
}

function syncEvent() {
  return {
    requestId: "request-1",
    channelId: "channel-session",
    afterSequence: 0,
    limit: 50,
  };
}

function ticketResponse() {
  return {
    ticket: "gateway-ticket",
    gatewayUrl: "wss://gateway.example.test/realtime-chat",
    expiresAt: "2026-07-18T00:01:00.000Z",
  };
}

function connectedEvent(connectionGeneration: string): string {
  return JSON.stringify({
    protocolVersion: 1,
    connectionGeneration,
    gatewayId: "gateway-1",
    sessionId: `session-${connectionGeneration}`,
    connectedAt: "2026-07-18T00:00:00.000Z",
  });
}
