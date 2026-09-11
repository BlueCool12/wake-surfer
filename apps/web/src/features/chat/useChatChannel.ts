import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  ChatMessage,
  KeyValueStorage,
  ReadScope,
  RealtimeChatMessage,
  RealtimeChatMessageStatus,
  RealtimeChatTargetSession,
  StreamMessagesClientTarget,
} from "@wake-surfer/realtime-chat-stream-messages-client";
import { getConfiguredChatActorId, getConfiguredChatSession } from "./transport/browserChatRuntime";

const cursorValues = new Map<string, string>();
const pageLifetimeCursorStorage: KeyValueStorage = {
  getItem: (key) => cursorValues.get(key) ?? null,
  removeItem: (key) => cursorValues.delete(key),
  setItem: (key, value) => cursorValues.set(key, value),
};

export type ChatMessageStatus = RealtimeChatMessageStatus;
export type ChatMessageView = {
  key: string;
  idempotencyKey?: string;
  messageId?: string;
  sequence?: number;
  senderId?: string;
  isMine: boolean;
  text: string;
  createdAt: string;
  status: ChatMessageStatus;
  isDeleted: boolean;
  isEdited: boolean;
};

/** 세션 핸들만 얻는다. 구독과 연결 시작은 이 훅의 책임이 아니다. */
export function useChatSession(
  target: StreamMessagesClientTarget,
  actorId = getConfiguredChatActorId(),
): RealtimeChatTargetSession {
  const type = target.type;
  const id = type === "channel" ? target.channelId : target.threadId;
  return useMemo(
    () =>
      getConfiguredChatSession({
        actorId,
        target: type === "channel" ? { type, channelId: id } : { type, threadId: id },
        storage: pageLifetimeCursorStorage,
      }),
    [actorId, id, type],
  );
}

export function useStartChatSession(session: RealtimeChatTargetSession): void {
  useEffect(() => {
    void session.ensureStarted().catch(() => undefined);
  }, [session]);
}

export function useChatScope<T>(scope: ReadScope<T>): T {
  useSyncExternalStore(scope.subscribe, scope.getVersion, scope.getVersion);
  return scope.value;
}

const missingMessage: ReadScope<ChatMessage | undefined> = {
  value: undefined,
  subscribe: () => () => undefined,
  getVersion: () => 0,
};

export function useChatMessageLookup(
  session: RealtimeChatTargetSession,
  key: string | undefined,
): ChatMessage | undefined {
  return useChatScope(key === undefined ? missingMessage : session.message(key));
}

export function useChatMessage(
  session: RealtimeChatTargetSession,
  key: string | undefined,
): ChatMessage | undefined {
  const message = useChatMessageLookup(session, key);
  const source = message ?? missingMessage;
  useSyncExternalStore(source.subscribe, source.getVersion, source.getVersion);
  return message;
}

export function toChatMessageView(message: RealtimeChatMessage): ChatMessageView {
  return {
    key: message.key,
    ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }),
    ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
    ...(message.sequence === undefined ? {} : { sequence: message.sequence }),
    ...(message.senderActorId === undefined ? {} : { senderId: message.senderActorId }),
    isMine: message.isOwn,
    text: message.content?.text ?? "삭제된 메시지입니다.",
    createdAt: message.createdAt,
    status: message.status,
    isDeleted: message.content === null,
    isEdited: message.isEdited,
  };
}
