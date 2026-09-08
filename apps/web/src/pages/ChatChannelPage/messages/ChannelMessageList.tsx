import { useState } from "react";
import type { RefObject } from "react";

import type { UseChatChannelResult } from "../../../features/chat/useChatChannel";
import type { MessageReactionsValue } from "./MessageReactionsView";
import { getMessageActionAvailability } from "../messageActionPolicy";
import { MessageListView } from "./MessageListView";

type ChannelMessageListProps = Pick<
  UseChatChannelResult,
  | "messages"
  | "isLoading"
  | "isLoadingOlder"
  | "olderFailed"
  | "hasMoreBefore"
  | "recoveryPhase"
  | "loadOlder"
  | "retryRecovery"
  | "retryMessage"
  | "discardMessage"
> & {
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedThreadKey: string | undefined;
  onOpenThread: (messageKey: string) => void;
  unreadCount: number;
};

// 메시지별 표시 데이터와 동작을 연결한다. 세션 구독은 대화 영역에서 유지한다.
export function ChannelMessageList({
  messages,
  isLoading,
  isLoadingOlder,
  olderFailed,
  hasMoreBefore,
  recoveryPhase,
  loadOlder,
  retryRecovery,
  retryMessage,
  discardMessage,
  scrollRef,
  selectedThreadKey,
  onOpenThread,
  unreadCount,
}: ChannelMessageListProps) {
  // 상태: 메시지별 리액션 수와 내 반응 여부. 빈 객체로 시작하며, 클릭으로만 갱신하는 목록 기능 내부 상태다.
  // 서버에 저장하지 않으며, 컴포넌트가 제거되면 사라진다. 채널 변경만으로는 비워지지 않는다.
  const [reactionsByMessageKey, setReactionsByMessageKey] = useState<
    Record<string, MessageReactionsValue>
  >({});

  const handleToggleReaction = (messageKey: string, emoji: string) => {
    setReactionsByMessageKey((prev) => {
      const current = prev[messageKey] ?? {};
      const wasReacted = current[emoji]?.reactedByMe ?? false;
      const nextCount = (current[emoji]?.count ?? 0) + (wasReacted ? -1 : 1);

      const nextMessageReactions = { ...current };
      if (nextCount <= 0) {
        delete nextMessageReactions[emoji];
      } else {
        nextMessageReactions[emoji] = { count: nextCount, reactedByMe: !wasReacted };
      }

      return { ...prev, [messageKey]: nextMessageReactions };
    });
  };

  // 기존 자동 이동 정책을 유지한다. 새 메시지 이벤트를 기준으로 바꾸는 작업은 별도다.
  const shouldFollowLatest = (isNearBottom: boolean) =>
    isNearBottom || (messages.at(-1)?.isMine ?? false);

  const items = messages.map((message) => {
    const available = getMessageActionAvailability(message);
    return {
      message,
      onRetry: available.canRetry ? () => retryMessage(message) : undefined,
      onDiscard: available.canDiscard ? () => discardMessage(message) : undefined,
      isThreadActive: message.key === selectedThreadKey,
      onOpenThread: available.canOpenThread ? () => onOpenThread(message.key) : undefined,
      reactions: reactionsByMessageKey[message.key] ?? {},
      onToggleReaction: available.canReact
        ? (emoji: string) => handleToggleReaction(message.key, emoji)
        : undefined,
      unreadCount,
    };
  });

  return (
    <MessageListView
      isLoading={isLoading}
      isLoadingOlder={isLoadingOlder}
      olderFailed={olderFailed}
      hasMoreBefore={hasMoreBefore}
      recoveryPhase={recoveryPhase}
      scrollRef={scrollRef}
      loadOlder={loadOlder}
      retryRecovery={retryRecovery}
      items={items}
      shouldFollowLatest={shouldFollowLatest}
    />
  );
}
