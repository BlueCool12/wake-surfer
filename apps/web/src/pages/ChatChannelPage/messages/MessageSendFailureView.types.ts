import type { ChatMessageView } from "../../../features/chat/useChatChannel";

export type MessageSendFailureViewProps = {
  message: ChatMessageView;
  isThreadActive: boolean;
  onRetry?: (() => void) | undefined;
  onDiscard?: (() => void) | undefined;
};
