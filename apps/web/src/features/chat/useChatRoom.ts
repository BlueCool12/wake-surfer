import { useEffect, useMemo, useSyncExternalStore } from "react";

import { getChatRoomModel } from "./chatRoomRegistry";
import { MOCK_ME } from "./transport/mockChatTransport";

import type { ChatMessageView } from "./chatRoomModel";

export type { ChatMessageStatus, ChatMessageView } from "./chatRoomModel";

export type UseChatRoomResult = {
  messages: ChatMessageView[];
  isLoading: boolean;
  isLoadingOlder: boolean;
  olderFailed: boolean;
  hasMoreBefore: boolean;
  recoveryPhase: string;
  loadOlder: () => void;
  retryRecovery: () => void;
  sendMessage: (text: string) => void;
  retryMessage: (message: ChatMessageView) => void;
};

export function useChatRoom(channelId: string, actorId = MOCK_ME): UseChatRoomResult {
  const model = useMemo(
    () =>
      getChatRoomModel({
        actorId,
        channelId,
        storage: window.sessionStorage,
      }),
    [actorId, channelId],
  );
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
    loadOlder: () => void model.loadOlder().catch(() => undefined),
    retryRecovery: () => void model.start().catch(() => undefined),
    sendMessage: (text) => model.sendMessage(text),
    retryMessage: (message) => model.retryMessage(message),
  };
}
