import { describe, expect, it, vi } from "vitest";

import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  KeyValueStorage,
  StreamMessagesTransport,
} from "@wake-surfer/realtime-chat-stream-messages-client";

import { ChatRoomModel } from "./chatRoomModel";

import type {
  ChatMessageTransport,
  ChatRoomRuntime,
  MessageAcceptedResponse,
  MessageRejectedResponse,
} from "./transport/chatTransport";

describe("ChatRoomModel", () => {
  it("projects latest messages and recovery state outside React", async () => {
    const runtime = createRuntime("channel-model-1", {
      loadLatest: vi.fn(async () =>
        measured(latestResponse("channel-model-1", [message(1, "channel-model-1")])),
      ),
    });
    const model = createModel("model-1", "channel-model-1", runtime);

    await model.start();

    expect(model.recoveryPhase).toBe("ready");
    expect(model.messages).toEqual([
      expect.objectContaining({ key: "message-1", sequence: 1, status: "sent" }),
    ]);
  });

  it("keeps live messages that arrive before latest and drains them after the checkpoint", async () => {
    let resolveLatest:
      ((value: Awaited<ReturnType<StreamMessagesTransport["loadLatest"]>>) => void) | undefined;
    const runtime = createRuntime("channel-model-2", {
      loadLatest: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<StreamMessagesTransport["loadLatest"]>>>((resolve) => {
            resolveLatest = resolve;
          }),
      ),
    });
    const model = createModel("model-2", "channel-model-2", runtime);
    const start = model.start();
    await Promise.resolve();
    runtime.emitCreated(message(2, "channel-model-2"));
    resolveLatest?.(measured(latestResponse("channel-model-2", [message(1, "channel-model-2")])));
    await start;

    expect(model.messages.map((item) => item.sequence)).toEqual([1, 2]);
    expect(model.streamSession.timeline.deliverySyncCursor).toBe(2);
  });

  it("owns optimistic, rejected, retry, and accepted state without React copies", async () => {
    const runtime = createRuntime("channel-model-3");
    const model = createModel("model-3", "channel-model-3", runtime);
    await model.start();

    model.sendMessage(" hello ");
    expect(model.messages.at(-1)).toMatchObject({
      clientMessageId: "client-model-3",
      status: "pending",
      text: "hello",
    });
    runtime.emitRejected({
      status: "rejected",
      clientMessageId: "client-model-3",
      reason: "write_forbidden",
    });
    expect(model.messages.at(-1)?.status).toBe("failed");

    model.retryMessage(model.messages.at(-1)!);
    expect(model.messages.at(-1)?.status).toBe("pending");
    expect(runtime.messageTransport.sendChannelMessage).toHaveBeenCalledTimes(2);
    expect(runtime.messageTransport.sendChannelMessage).toHaveBeenNthCalledWith(2, {
      clientMessageId: "client-model-3",
      content: { type: "text", text: "hello" },
      sentAtClient: "2026-07-18T00:00:00.000Z",
    });

    const acceptedMessage = message(1, "channel-model-3");
    runtime.emitAccepted({
      status: "accepted",
      clientMessageId: "client-model-3",
      message: acceptedMessage,
    });
    runtime.emitCreated(acceptedMessage);
    expect(model.messages).toEqual([
      expect.objectContaining({ messageId: "message-1", status: "sent" }),
    ]);
  });

  it("marks an optimistic message failed when the realtime socket cannot send", async () => {
    const runtime = createRuntime("channel-model-4");
    vi.mocked(runtime.messageTransport.sendChannelMessage).mockImplementationOnce(() => {
      throw new Error("socket closed");
    });
    const model = createModel("model-4", "channel-model-4", runtime);
    await model.start();

    model.sendMessage("연결 전송 실패");

    expect(model.messages.at(-1)).toMatchObject({
      clientMessageId: "client-model-4",
      status: "failed",
      text: "연결 전송 실패",
    });
  });

  it("runs one cursor recovery per connection generation and queues reconnects", async () => {
    let resolveFirstSync:
      ((value: Awaited<ReturnType<StreamMessagesTransport["syncAfter"]>>) => void) | undefined;
    const syncAfter = vi.fn((request: Parameters<StreamMessagesTransport["syncAfter"]>[0]) => {
      if (request.afterSequence === 0) {
        return new Promise<Awaited<ReturnType<StreamMessagesTransport["syncAfter"]>>>((resolve) => {
          resolveFirstSync = resolve;
        });
      }

      return Promise.resolve(
        measured(syncResponse("channel-model-5", request.afterSequence, request.afterSequence, [])),
      );
    });
    const runtime = createRuntime("channel-model-5", { syncAfter });
    const model = createModel("model-5", "channel-model-5", runtime);
    await model.start();

    runtime.emitConnectionGeneration("generation-2");
    runtime.emitConnectionGeneration("generation-2");
    runtime.emitConnectionGeneration("generation-3");
    expect(syncAfter).toHaveBeenCalledTimes(1);

    resolveFirstSync?.(
      measured(syncResponse("channel-model-5", 0, 1, [message(1, "channel-model-5")])),
    );
    await vi.waitFor(() => expect(syncAfter).toHaveBeenCalledTimes(2));

    expect(syncAfter).toHaveBeenNthCalledWith(
      2,
      {
        channelId: "channel-model-5",
        afterSequence: 1,
        limit: 50,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(model.messages.map((item) => item.sequence)).toEqual([1]);
  });

  it("exposes retry recovery after disconnect and reconnects a ready timeline", async () => {
    const syncAfter = vi.fn(async (request: Parameters<StreamMessagesTransport["syncAfter"]>[0]) =>
      measured(syncResponse("channel-model-6", request.afterSequence, request.afterSequence, [])),
    );
    const runtime = createRuntime("channel-model-6", { syncAfter });
    const model = createModel("model-6", "channel-model-6", runtime);
    await model.start();
    runtime.emitDisconnected();
    expect(model.recoveryPhase).toBe("retryable_failure");
    vi.mocked(runtime.messageTransport.connect).mockImplementationOnce(async () => {
      runtime.emitConnectionGeneration("generation-reopened");
    });

    await model.start();

    expect(runtime.messageTransport.connect).toHaveBeenCalledTimes(2);
    expect(syncAfter).toHaveBeenCalledWith(
      {
        channelId: "channel-model-6",
        afterSequence: 0,
        limit: 50,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("reconciles an optimistic message when reconnect recovery replaces a lost accepted frame", async () => {
    const sentAtClient = "2026-07-18T00:00:00.000Z";
    const recoveredMessage: PublicMessage = {
      ...message(1, "channel-model-7"),
      senderActorId: "model-7",
      content: { type: "text", text: "수락 응답 유실" },
      sentAtClient,
    };
    const syncAfter = vi.fn(async () =>
      measured(syncResponse("channel-model-7", 0, 1, [recoveredMessage])),
    );
    const runtime = createRuntime("channel-model-7", { syncAfter });
    const model = createModel("model-7", "channel-model-7", runtime);
    await model.start();
    model.sendMessage("수락 응답 유실");

    runtime.emitDisconnected();
    expect(model.messages.at(-1)?.status).toBe("failed");
    expect(model.recoveryPhase).toBe("retryable_failure");
    runtime.emitConnectionGeneration("generation-after-accepted-loss");
    await vi.waitFor(() => expect(model.recoveryPhase).toBe("ready"));

    expect(model.messages).toEqual([
      expect.objectContaining({
        messageId: "message-1",
        status: "sent",
        text: "수락 응답 유실",
      }),
    ]);
    expect(runtime.messageTransport.sendChannelMessage).toHaveBeenCalledWith({
      clientMessageId: "client-model-7",
      content: { type: "text", text: "수락 응답 유실" },
      sentAtClient,
    });
  });

  it("keeps recovery retryable when latest loading finishes after the connection is lost", async () => {
    let resolveLatest:
      ((value: Awaited<ReturnType<StreamMessagesTransport["loadLatest"]>>) => void) | undefined;
    const loadLatest = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<StreamMessagesTransport["loadLatest"]>>>((resolve) => {
          resolveLatest = resolve;
        }),
    );
    const runtime = createRuntime("channel-model-8", { loadLatest });
    const model = createModel("model-8", "channel-model-8", runtime);
    const start = model.start();
    await vi.waitFor(() => expect(loadLatest).toHaveBeenCalledTimes(1));

    runtime.emitDisconnected();
    resolveLatest?.(measured(latestResponse("channel-model-8", [])));
    await start;

    expect(model.recoveryPhase).toBe("retryable_failure");
  });
});

function createModel(actorId: string, channelId: string, runtime: ChatRoomRuntime): ChatRoomModel {
  return new ChatRoomModel({
    actorId,
    channelId,
    createClientMessageId: () => `client-${actorId}`,
    now: () => "2026-07-18T00:00:00.000Z",
    runtime,
    storage: createMemoryStorage(),
  });
}

function createRuntime(
  channelId: string,
  streamOverrides: Partial<StreamMessagesTransport> = {},
): ChatRoomRuntime & {
  emitAccepted: (response: MessageAcceptedResponse) => void;
  emitConnectionGeneration: (connectionGeneration: string) => void;
  emitCreated: (message: PublicMessage) => void;
  emitDisconnected: () => void;
  emitRejected: (response: MessageRejectedResponse) => void;
} {
  const created = createEmitter<PublicMessage>();
  const accepted = createEmitter<MessageAcceptedResponse>();
  const rejected = createEmitter<MessageRejectedResponse>();
  const connectionGenerations = createEmitter<string>();
  const disconnected = createEmitter<void>();
  let ready = false;
  const messageTransport: ChatMessageTransport = {
    connect: vi.fn(async () => {
      ready = true;
    }),
    disconnect: vi.fn(() => {
      ready = false;
    }),
    isReady: () => ready,
    sendChannelMessage: vi.fn(),
    onConnectionGenerationChanged: connectionGenerations.subscribe,
    onDisconnected: disconnected.subscribe,
    onMessageCreated: created.subscribe,
    onMessageAccepted: accepted.subscribe,
    onMessageRejected: rejected.subscribe,
  };
  const streamMessagesTransport: StreamMessagesTransport = {
    loadLatest:
      streamOverrides.loadLatest ?? vi.fn(async () => measured(latestResponse(channelId, []))),
    loadOlder:
      streamOverrides.loadOlder ??
      vi.fn(async () => {
        throw new Error("unexpected older query");
      }),
    syncAfter:
      streamOverrides.syncAfter ??
      vi.fn(async () => {
        throw new Error("unexpected sync query");
      }),
  };

  return {
    messageTransport,
    streamMessagesTransport,
    emitAccepted: accepted.emit,
    emitConnectionGeneration: (connectionGeneration) => {
      ready = true;
      connectionGenerations.emit(connectionGeneration);
    },
    emitCreated: created.emit,
    emitDisconnected: () => {
      ready = false;
      disconnected.emit(undefined);
    },
    emitRejected: rejected.emit,
  };
}

function createEmitter<Value>() {
  const listeners = new Set<(value: Value) => void>();
  return {
    emit(value: Value) {
      for (const listener of listeners) listener(value);
    },
    subscribe(listener: (value: Value) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function latestResponse(channelId: string, messages: PublicMessage[]) {
  const oldest = messages[0];
  const newest = messages.at(-1);
  return {
    streamId: `channel:${channelId}`,
    throughSequence: newest?.sequence ?? 0,
    messages,
    nextBeforeSequence: oldest?.sequence ?? null,
    hasMoreBefore: (oldest?.sequence ?? 1) > 1,
  };
}

function message(sequence: number, channelId: string): PublicMessage {
  return {
    messageId: `message-${sequence}`,
    streamId: `channel:${channelId}`,
    sequence,
    senderActorId: "actor-other",
    target: { type: "channel", channelId },
    content: { type: "text", text: `message ${sequence}` },
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}

function syncResponse(
  channelId: string,
  afterSequence: number,
  throughSequence: number,
  messages: PublicMessage[],
) {
  return {
    streamId: `channel:${channelId}`,
    afterSequence,
    throughSequence,
    messages,
    nextAfterSequence: messages.at(-1)?.sequence ?? throughSequence,
    hasMoreAfter: false,
  };
}

function measured<Response>(response: Response) {
  return {
    response,
    rawUtf8ByteLength: new TextEncoder().encode(JSON.stringify(response)).byteLength,
  };
}

function createMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
