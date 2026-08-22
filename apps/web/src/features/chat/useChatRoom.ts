import { useEffect, useMemo, useSyncExternalStore } from "react";

import type {
  KeyValueStorage,
  StreamMessagesClientTarget,
} from "@wake-surfer/realtime-chat-stream-messages-client";

import { getChatRoomModel } from "./chatRoomRegistry";
import { getConfiguredChatActorId } from "./transport/browserChatRuntime";

import type { ChatMessageView } from "./chatRoomModel";

const cursorValues = new Map<string, string>();
const pageLifetimeCursorStorage: KeyValueStorage = {
  getItem: (key) => cursorValues.get(key) ?? null,
  removeItem: (key) => cursorValues.delete(key),
  setItem: (key, value) => cursorValues.set(key, value),
};

export type { ChatMessageStatus, ChatMessageView } from "./chatRoomModel";

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
  const model = useMemo(() => {
    const stableTarget: StreamMessagesClientTarget =
      targetType === "channel"
        ? { type: "channel", channelId: targetId }
        : { type: "thread", threadId: targetId };

    return getChatRoomModel({
      actorId,
      target: stableTarget,
      // Cursor만 영속화하고 message snapshot은 영속화하지 않으므로 새 문서에서는 latest를 다시 읽는다.
      storage: pageLifetimeCursorStorage,
    });
  }, [actorId, targetId, targetType]);
  const version = useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  void version;

  useEffect(() => {
    void model.start().catch(() => undefined);
  }, [model]);

  return {
    messages: model.messages,
    isLoading: model.isLoading,
    isLoadingOlder: model.isLoadingOlder,
    olderFailed: model.olderFailed,
    hasMoreBefore: model.hasMoreBefore,
    recoveryPhase: model.recoveryPhase,
    deleteMessage: (message) => model.deleteMessage(message),
    discardMessage: (message) => model.discardMessage(message),
    editMessage: (message, text) => model.editMessage(message, text),
    loadOlder: () => void model.loadOlder().catch(() => undefined),
    retryRecovery: () => void model.start().catch(() => undefined),
    sendMessage: (text) => model.sendMessage(text),
    retryMessage: (message) => model.retryMessage(message),
  };
}
