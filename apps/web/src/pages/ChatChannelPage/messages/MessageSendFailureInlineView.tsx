import { RotateCw, X } from "lucide-react";

import { MessageBubbleFrameView } from "./MessageBubbleFrameView";
import type { MessageSendFailureViewProps } from "./MessageSendFailureView.types";
import styles from "./MessageBubbleView.module.css";

/** 말풍선 안에 재전송·버리기 버튼을 표시하고 버리기 전에 확인한다. */
export function MessageSendFailureInlineView({
  message,
  isThreadActive,
  onRetry,
  onDiscard,
}: MessageSendFailureViewProps) {
  const hasActions = onRetry !== undefined || onDiscard !== undefined;

  const handleDiscard = () => {
    if (!window.confirm("메시지를 삭제할까요?")) return;
    onDiscard?.();
  };

  return (
    <MessageBubbleFrameView message={message} isThreadActive={isThreadActive}>
      <span className={styles.text}>{message.text}</span>
      <span className={styles.retryRow}>
        전송 실패
        {hasActions ? (
          <span className={styles.retryDivider} aria-hidden="true">
            ·
          </span>
        ) : null}
        {onRetry !== undefined ? (
          <button
            type="button"
            className={styles.actionButton}
            onClick={onRetry}
            aria-label="다시 시도"
          >
            <RotateCw size={10} />
          </button>
        ) : null}
        {onDiscard !== undefined ? (
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleDiscard}
            aria-label="메시지 삭제"
          >
            <X size={10} />
          </button>
        ) : null}
      </span>
    </MessageBubbleFrameView>
  );
}
