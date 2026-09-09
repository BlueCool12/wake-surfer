import { useCallback, useMemo, useState, type RefObject } from "react";
import type { RealtimeChatTargetSession } from "@wake-surfer/realtime-chat-stream-messages-client";
import { useChatMessageLookup, useChatScope } from "../../../features/chat/useChatChannel";
import type { MessageReactionsValue } from "./MessageReactionsView";
import { MessageListView } from "./MessageListView";
import { MessageItemsView } from "./MessageItemsView";
import { ChatHistoryStatus, ChatOlderHistory } from "./ChatHistoryStatus";

export function ChannelMessageList({
  session,
  scrollRef,
  selectedThreadKey,
  onOpenThread,
  unreadCount,
}: {
  session: RealtimeChatTargetSession;
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedThreadKey: string | undefined;
  onOpenThread: (key: string) => void;
  unreadCount: number;
}) {
  const keys = useChatScope(session.messageKeys);
  const keysVersion = session.messageKeys.getVersion();
  const ready = useChatScope(session.initialHistory);
  const selected = useChatMessageLookup(session, selectedThreadKey);
  const [reactions, setReactions] = useState<ReadonlyMap<string, MessageReactionsValue>>(
    () => new Map(),
  );
  // 별칭만 가진 서버 행의 반응은 canonical 행으로 옮기고, 기존 로컬 값을 우선한다.
  const canonicalReactions = useMemo(() => {
    const next = new Map<string, MessageReactionsValue>();
    for (const [key, value] of reactions) {
      const canonical = session.message(key).value?.key ?? key;
      if (key === canonical || !next.has(canonical)) next.set(canonical, value);
    }
    return next;
  }, [reactions, session, keysVersion]);
  const toggle = useCallback(
    (key: string, emoji: string) => {
      setReactions((previous) => {
        const canonical = new Map<string, MessageReactionsValue>();
        for (const [oldKey, value] of previous) {
          const resolved = session.message(oldKey).value?.key ?? oldKey;
          if (oldKey === resolved || !canonical.has(resolved)) canonical.set(resolved, value);
        }
        const current = canonical.get(key) ?? {};
        const reacted = current[emoji]?.reactedByMe ?? false;
        const count = (current[emoji]?.count ?? 0) + (reacted ? -1 : 1);
        const updated = { ...current };
        if (count <= 0) delete updated[emoji];
        else updated[emoji] = { count, reactedByMe: !reacted };
        canonical.set(key, updated);
        return canonical;
      });
    },
    [session],
  );
  return (
    <MessageListView initialHistoryReady={ready} scrollRef={scrollRef}>
      <ChatOlderHistory session={session} />
      <ChatHistoryStatus
        session={session}
        empty={keys.length === 0}
        emptyText="아직 메시지가 없습니다."
      />
      <MessageItemsView
        session={session}
        keys={keys}
        selectedKey={selected?.key}
        reactions={canonicalReactions}
        onOpenThread={onOpenThread}
        onToggleReaction={toggle}
        unreadCount={unreadCount}
      />
    </MessageListView>
  );
}
