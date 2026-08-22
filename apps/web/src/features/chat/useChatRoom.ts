import { useEffect, useMemo, useSyncExternalStore } from "react";

import type {
  KeyValueStorage,
  RealtimeChatMessage,
  RealtimeChatMessageStatus,
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

export type UseChatRoomResult = {
  messages: ChatMessageView[];
  isLoading: boolean;
  isLoadingOlder: boolean;
  olderFailed: boolean;
  hasMoreBefore: boolean;
  recoveryPhase: string;
  deleteMessage: (message: ChatMessageView) => void;
  discardMessage: (message: ChatMessageView) => void;
  editMessage: (message: ChatMessageView, text: string) => void;
  loadOlder: () => void;
  retryRecovery: () => void;
  sendMessage: (text: string) => void;
  retryMessage: (message: ChatMessageView) => void;
};

export function useChatRoom(
  channelId: string,
  actorId = getConfiguredChatActorId(),
): UseChatRoomResult {
  return useChatTarget({ type: "channel", channelId }, actorId);
}

export function useChatThread(
  threadId: string,
  actorId = getConfiguredChatActorId(),
): UseChatRoomResult {
  return useChatTarget({ type: "thread", threadId }, actorId);
}

function useChatTarget(target: StreamMessagesClientTarget, actorId: string): UseChatRoomResult {
  const targetType = target.type;
  const targetId = target.type === "channel" ? target.channelId : target.threadId;
  const session = useMemo(() => {
    const stableTarget: StreamMessagesClientTarget =
      targetType === "channel"
        ? { type: "channel", channelId: targetId }
        : { type: "thread", threadId: targetId };

    return getConfiguredChatSession({
      actorId,
      target: stableTarget,
      // Cursor만 영속화하고 message snapshot은 영속화하지 않으므로 새 문서에서는 latest를 다시 읽는다.
      storage: pageLifetimeCursorStorage,
    });
  }, [actorId, targetId, targetType]);
  const version = useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  void version;

  useEffect(() => {
    void session.start().catch(() => undefined);
  }, [session]);

  return {
    messages: session.messages.map(toChatMessageView),
    isLoading: session.isLoading,
    isLoadingOlder: session.isLoadingOlder,
    olderFailed: session.olderFailed,
    hasMoreBefore: session.hasMoreBefore,
    recoveryPhase: session.recoveryPhase,
    deleteMessage: (message) => {
      const source = findSourceMessage(session.messages, message.key);
      if (source !== undefined) session.deleteMessage(source);
    },
    discardMessage: (message) => {
      const source = findSourceMessage(session.messages, message.key);
      if (source !== undefined) session.discardMessage(source);
    },
    editMessage: (message, text) => {
      const source = findSourceMessage(session.messages, message.key);
      if (source !== undefined) session.editMessage(source, text);
    },
    loadOlder: () => void session.loadOlder().catch(() => undefined),
    retryRecovery: () => void session.start().catch(() => undefined),
    sendMessage: (text) => session.sendMessage(text),
    retryMessage: (message) => {
      const source = findSourceMessage(session.messages, message.key);
      if (source !== undefined) session.retryMessage(source);
    },
  };
}

function findSourceMessage(
  messages: RealtimeChatMessage[],
  key: string,
): RealtimeChatMessage | undefined {
  return messages.find((message) => message.key === key);
}

function toChatMessageView(message: RealtimeChatMessage): ChatMessageView {
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
