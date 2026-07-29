import { RotateCw } from "lucide-react";

import type { ChatMessageView } from "../../features/chat/useChatRoom";
import { formatTime } from "../../utils/date";
import styles from "./MessageBubble.module.css";

type MessageBubbleProps = {
  message: ChatMessageView;
  /** 전송 실패한 메시지를 다시 보낼 때 호출. */
  onRetry?: (() => void) | undefined;
};

/** 채팅방의 메시지 한 건을 말풍선으로 렌더링한다. 내/상대, 전송 상태에 따라 스타일이 달라진다. */
function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const rowClass = message.isMine ? `${styles.row} ${styles.rowMine}` : styles.row;
  const bubbleClass = [
    styles.bubble,
    message.isMine ? styles.bubbleMine : styles.bubbleOther,
    message.status === "pending" ? styles.bubblePending : "",
    message.status === "failed" ? styles.bubbleFailed : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClass}>
      <div className={bubbleClass}>
        <span className={styles.text}>{message.text}</span>
        {message.status === "failed" ? (
          <span className={styles.retryRow}>
            전송 실패
            <button type="button" className={styles.retry} onClick={onRetry} aria-label="다시 시도">
              <RotateCw size={12} />
            </button>
          </span>
        ) : (
          <span className={styles.meta}>
            {message.status === "pending" ? "전송 중…" : formatTime(message.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
