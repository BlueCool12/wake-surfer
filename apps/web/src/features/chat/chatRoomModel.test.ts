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
  emitCreated: (message: PublicMessage) => void;
  emitRejected: (response: MessageRejectedResponse) => void;
} {
  const created = createEmitter<PublicMessage>();
  const accepted = createEmitter<MessageAcceptedResponse>();
  const rejected = createEmitter<MessageRejectedResponse>();
  const messageTransport: ChatMessageTransport = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    sendChannelMessage: vi.fn(),
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
    emitCreated: created.emit,
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
