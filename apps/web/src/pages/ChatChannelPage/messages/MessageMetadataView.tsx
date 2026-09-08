import { MessagesSquare } from "lucide-react";

import type { ChatMessageView } from "../../../features/chat/useChatChannel";
import { formatTime } from "../../../utils/date";
import styles from "./MessageBubbleView.module.css";

export function MessageMetadataView({
  message,
  replyCount,
}: {
  message: ChatMessageView;
  replyCount: number;
}) {
  return (
    <span className={styles.metaRow}>
      {replyCount > 0 ? (
        <>
          <span className={styles.threadCount}>
            <MessagesSquare size={11} />
            {replyCount}
          </span>
          <span className={styles.retryDivider} aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      <span className={styles.metaText}>
        {message.status === "pending"
          ? "전송 중…"
          : message.isEdited
            ? `수정됨 · ${formatTime(message.createdAt)}`
            : formatTime(message.createdAt)}
      </span>
    </span>
  );
}
