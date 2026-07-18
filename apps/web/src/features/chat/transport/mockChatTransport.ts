import {
  getCanonicalStreamId,
  type PublicMessage,
} from "@wake-surfer/realtime-chat-message-contracts";
import type { SendMessageResponse } from "@wake-surfer/realtime-chat-message-send-contracts";

import type {
  ChatMessageTransport,
  ChatRoomRuntime,
  ChatRoomRuntimeContext,
  MessageAcceptedResponse,
  MessageRejectedResponse,
} from "./chatTransport";

export const MOCK_ME = "user-me";
const MOCK_OTHER = "user-wave";

type Listener<T> = (value: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(value: T): void {
      for (const listener of listeners) listener(value);
    },
  };
}

export function createMockChatRoomRuntime(context: ChatRoomRuntimeContext): ChatRoomRuntime {
  const created = createEmitter<PublicMessage>();
  const accepted = createEmitter<MessageAcceptedResponse>();
  const rejected = createEmitter<MessageRejectedResponse>();
  const streamId = getCanonicalStreamId({ type: "channel", channelId: context.channelId });
  let sequence = 0;
  const nextSequence = () => (sequence += 1);
  const failedOnce = new Set<string>();
  const history: PublicMessage[] = [
    createMessage(
      "m1",
      nextSequence(),
      MOCK_OTHER,
      "안녕하세요! 실시간 채팅 목업이에요 👋",
      new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    ),
    createMessage(
      "m2",
      nextSequence(),
      context.actorId,
      "네, 아래 입력창으로 보내보면 에코로 답이 와요.",
      new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    ),
  ];

  function createMessage(
    messageId: string,
    messageSequence: number,
    senderActorId: string,
    text: string,
    createdAt: string,
  ): PublicMessage {
    return {
      messageId,
      streamId,
      sequence: messageSequence,
      senderActorId,
      target: { type: "channel", channelId: context.channelId },
      content: { type: "text", text },
      createdAt,
    };
  }

  const messageTransport: ChatMessageTransport = {
    async connect() {},
    disconnect() {},
    sendChannelMessage({ clientMessageId, content }) {
      window.setTimeout(() => {
        if (content.text.startsWith("/fail") && !failedOnce.has(clientMessageId)) {
          failedOnce.add(clientMessageId);
          rejected.emit({
            status: "rejected",
            commandId: crypto.randomUUID(),
            clientMessageId,
            reason: "write_forbidden",
          });
          return;
        }

        const message = createMessage(
          `m-${crypto.randomUUID()}`,
          nextSequence(),
          context.actorId,
          content.text,
          new Date().toISOString(),
        );
        history.push(message);
        const response: SendMessageResponse = {
          status: "accepted",
          commandId: crypto.randomUUID(),
          clientMessageId,
          message,
        };
        accepted.emit(response);
        created.emit(message);

        window.setTimeout(() => {
          const echo = createMessage(
            `m-${crypto.randomUUID()}`,
            nextSequence(),
            MOCK_OTHER,
            `“${content.text}” 잘 받았어요!`,
            new Date().toISOString(),
          );
          history.push(echo);
          created.emit(echo);
        }, 700);
      }, 250);
    },
    onMessageCreated: created.subscribe,
    onMessageAccepted: accepted.subscribe,
    onMessageRejected: rejected.subscribe,
  };

  return {
    messageTransport,
    streamMessagesTransport: {
      async loadLatest() {
        const throughSequence = sequence;
        const messages = history.filter((message) => message.sequence <= throughSequence).slice(-5);
        const oldest = messages[0];
        const response = {
          streamId,
          throughSequence,
          messages,
          nextBeforeSequence: oldest?.sequence ?? null,
          hasMoreBefore: (oldest?.sequence ?? 1) > 1,
        };
        return measured(response);
      },
      async loadOlder(request) {
        const candidates = history.filter((message) => message.sequence < request.beforeSequence);
        const messages = candidates.slice(-request.limit);
        const oldest = messages[0];
        const response = {
          streamId,
          beforeSequence: request.beforeSequence,
          messages,
          nextBeforeSequence: oldest?.sequence ?? null,
          hasMoreBefore: (oldest?.sequence ?? 1) > 1,
        };
        return measured(response);
      },
      async syncAfter(request) {
        const throughSequence = request.throughSequence ?? sequence;
        const messages = history
          .filter(
            (message) =>
              message.sequence > request.afterSequence && message.sequence <= throughSequence,
          )
          .slice(0, request.limit);
        const nextAfterSequence = messages.at(-1)?.sequence ?? throughSequence;
        const response = {
          streamId,
          afterSequence: request.afterSequence,
          throughSequence,
          messages,
          nextAfterSequence,
          hasMoreAfter: nextAfterSequence < throughSequence,
        };
        return measured(response);
      },
    },
  };
}

function measured<Response>(response: Response): {
  response: Response;
  rawUtf8ByteLength: number;
} {
  return {
    response,
    rawUtf8ByteLength: new TextEncoder().encode(JSON.stringify(response)).byteLength,
  };
}
