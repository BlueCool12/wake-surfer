import { memo, useMemo } from "react";
import type { RealtimeChatTargetSession } from "@wake-surfer/realtime-chat-stream-messages-client";
import { toChatMessageView, useChatMessage } from "../../../features/chat/useChatChannel";
import MessageBubbleView from "./MessageBubbleView";
import type { MessageReactionsValue } from "./MessageReactionsView";

export const ChannelMessageRow = memo(function ChannelMessageRow({
  session,
  messageKey,
  isThreadActive = false,
  onOpenThread,
  reactions,
  onToggleReaction,
  unreadCount = 0,
}: {
  session: RealtimeChatTargetSession;
  messageKey: string;
  isThreadActive?: boolean;
  onOpenThread?: ((key: string) => void) | undefined;
  reactions?: MessageReactionsValue | undefined;
  onToggleReaction?: ((key: string, emoji: string) => void) | undefined;
  unreadCount?: number;
}) {
  const message = useChatMessage(session, messageKey);
  const version = message?.getVersion();
  const display = useMemo(
    () => (message === undefined ? undefined : toChatMessageView(message)),
    [message, version],
  );
  const actions = useMemo(() => {
    if (message === undefined) return {};
    return {
      onRetry: message.canRetry() ? () => message.retry() : undefined,
      onDiscard: message.canDiscard() ? () => message.discard() : undefined,
      onOpenThread:
        message.status === "sent" && onOpenThread !== undefined
          ? () => onOpenThread(message.key)
          : undefined,
      onToggleReaction:
        message.status === "sent" && !message.isDeleted && onToggleReaction !== undefined
          ? (emoji: string) => onToggleReaction(message.key, emoji)
          : undefined,
    };
  }, [message, version, onOpenThread, onToggleReaction]);
  if (display === undefined) return null;
  return (
    <MessageBubbleView
      message={display}
      {...actions}
      isThreadActive={isThreadActive}
      {...(reactions === undefined ? {} : { reactions })}
      unreadCount={unreadCount}
    />
  );
});
