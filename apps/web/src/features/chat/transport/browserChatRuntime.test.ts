import { describe, expect, it, vi } from "vitest";

import {
  createActorAuthenticatedFetch,
  createBrowserChatMessageTransport,
  resolveBrowserChatActorId,
  type ChatApplicationRealtimeSession,
} from "./browserChatRuntime";

describe("browser chat runtime", () => {
  it("resolves an explicit demo actor and falls back to the development actor", () => {
    expect(resolveBrowserChatActorId({ search: "?actor=actor-wave" })).toBe("actor-wave");
    expect(resolveBrowserChatActorId({ search: "" })).toBe("user-me");
  });

  it("adds the actor development header without dropping transport headers", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImplementation: typeof globalThis.fetch = (input, init) => {
      void input;
      capturedInit = init;
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const actorFetch = createActorAuthenticatedFetch({
      actorId: "actor-wave",
      fetch: fetchImplementation,
    });

    await actorFetch("http://localhost:3000/realtime-chat/gateway-tickets", {
      headers: { accept: "application/json" },
      method: "POST",
    });

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("x-actor-id")).toBe("actor-wave");
  });

  it("joins every connection generation and maps message application events", async () => {
    const session = new FakeApplicationSession();
    const transport = createBrowserChatMessageTransport({
      channelId: "channel-runtime",
      realtimeSession: session,
    });
    const accepted = vi.fn();
    const rejected = vi.fn();
    const created = vi.fn();
    const connectionGenerations = vi.fn();
    const disconnected = vi.fn();
    transport.onConnectionGenerationChanged(connectionGenerations);
    transport.onDisconnected(disconnected);
    transport.onMessageAccepted(accepted);
    transport.onMessageRejected(rejected);
    transport.onMessageCreated(created);

    await transport.connect();
    expect(transport.isReady()).toBe(true);
    expect(session.sent[0]).toEqual({
      eventName: "chat.channel.join",
      rawPayload: JSON.stringify({ channelId: "channel-runtime" }),
    });
    expect(connectionGenerations).toHaveBeenCalledWith("generation-1");

    transport.sendChannelMessage({
      idempotencyKey: "client-1",
      text: "파도",
    });
    expect(session.sent[1]).toEqual({
      eventName: "chat.message.send",
      rawPayload: JSON.stringify({
        idempotencyKey: "client-1",
        target: { type: "channel", channelId: "channel-runtime" },
        text: "파도",
      }),
    });

    const message = createMessage("channel-runtime");
    const { content, ...acceptedMessage } = message;
    session.serverEmit("chat.message.accepted", {
      status: "accepted",
      idempotencyKey: "client-1",
      message: {
        ...acceptedMessage,
        text: content.text,
      },
    });
    session.serverEmit("chat.message.rejected", {
      status: "rejected",
      idempotencyKey: "client-2",
      reason: "write_forbidden",
    });
    session.serverEmit("chat.message.created", message);
    session.serverEmit("chat.message.created", createMessage("another-channel"));
    expect(accepted).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted", idempotencyKey: "client-1" }),
    );
    expect(rejected).toHaveBeenCalledWith({
      status: "rejected",
      idempotencyKey: "client-2",
      reason: "write_forbidden",
    });
    expect(created).toHaveBeenCalledTimes(1);

    session.loseConnection();
    session.loseConnection();
    expect(transport.isReady()).toBe(false);
    expect(disconnected).toHaveBeenCalledTimes(1);

    session.reconnect("generation-2");
    expect(transport.isReady()).toBe(true);
    expect(session.sent.at(-1)).toEqual({
      eventName: "chat.channel.join",
      rawPayload: JSON.stringify({ channelId: "channel-runtime" }),
    });
    expect(connectionGenerations).toHaveBeenLastCalledWith("generation-2");
  });
});

class FakeApplicationSession implements ChatApplicationRealtimeSession {
  readonly sent: Array<{ eventName: string; rawPayload: string }> = [];
  readonly #applicationListeners = new Map<string, Set<(rawPayload: string) => void>>();
  readonly #stateListeners = new Set<() => void>();
  connectionGeneration: string | undefined;
  state: "connecting" | "ready" | "closed" = "closed";

  readonly connect = vi.fn(async () => {
    this.state = "ready";
    this.connectionGeneration = "generation-1";
    this.#emitState();
  });

  readonly sendApplicationEvent = (eventName: string, rawPayload: string): void => {
    this.sent.push({ eventName, rawPayload });
  };

  readonly onApplicationEvent = (
    eventName: string,
    listener: (rawPayload: string) => void,
  ): (() => void) => {
    let listeners = this.#applicationListeners.get(eventName);

    if (listeners === undefined) {
      listeners = new Set();
      this.#applicationListeners.set(eventName, listeners);
    }

    listeners.add(listener);
    return () => listeners?.delete(listener);
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  };

  reconnect(connectionGeneration: string): void {
    this.state = "ready";
    this.connectionGeneration = connectionGeneration;
    this.#emitState();
  }

  loseConnection(): void {
    this.state = "connecting";
    this.connectionGeneration = undefined;
    this.#emitState();
  }

  serverEmit(eventName: string, payload: unknown): void {
    const rawPayload = JSON.stringify(payload);

    for (const listener of this.#applicationListeners.get(eventName) ?? []) {
      listener(rawPayload);
    }
  }

  #emitState(): void {
    for (const listener of this.#stateListeners) {
      listener();
    }
  }
}

function createMessage(channelId: string) {
  return {
    messageId: `message-${channelId}`,
    streamId: `channel:${channelId}`,
    sequence: 1,
    senderActorId: "actor-wave",
    target: { type: "channel" as const, channelId },
    content: { type: "text" as const, text: "파도" },
    createdAt: "2026-07-25T00:00:00.000Z",
  };
}
