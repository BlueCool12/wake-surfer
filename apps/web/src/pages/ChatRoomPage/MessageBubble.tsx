import type { ChatMessageView } from "../../features/chat/useChatRoom";
import { formatTime } from "../../utils/date";
import styles from "./MessageBubble.module.css";

/** 채팅방의 메시지 한 건을 말풍선으로 렌더링한다. 내/상대, 전송 상태에 따라 스타일이 달라진다. */
function MessageBubble({ message }: { message: ChatMessageView }) {
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
        <span className={styles.meta}>
          {message.status === "failed"
            ? "전송 실패"
            : message.status === "pending"
              ? "전송 중…"
              : formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

export default MessageBubble;
