import { ChannelMessageRow } from "./ChannelMessageRow";
import type { RealtimeChatTargetSession } from "@wake-surfer/realtime-chat-stream-messages-client";
import type { MessageReactionsValue } from "./MessageReactionsView";

export function MessageItemsView({
  session,
  keys,
  selectedKey,
  reactions,
  onOpenThread,
  onToggleReaction,
  unreadCount,
}: {
  session: RealtimeChatTargetSession;
  keys: readonly string[];
  selectedKey: string | undefined;
  reactions: ReadonlyMap<string, MessageReactionsValue>;
  onOpenThread: (key: string) => void;
  onToggleReaction: (key: string, emoji: string) => void;
  unreadCount: number;
}) {
  return keys.map((key) => (
    <ChannelMessageRow
      key={key}
      session={session}
      messageKey={key}
      isThreadActive={key === selectedKey}
      reactions={reactions.get(key)}
      onOpenThread={onOpenThread}
      onToggleReaction={onToggleReaction}
      unreadCount={unreadCount}
    />
  ));
}
