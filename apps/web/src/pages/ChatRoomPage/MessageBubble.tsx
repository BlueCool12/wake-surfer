import { MessagesSquare, RotateCw, X } from "lucide-react";

import type { ChatMessageView } from "../../features/chat/useChatRoom";
import { formatTime } from "../../utils/date";
import MessageReactions, { type MessageReactionsValue } from "./MessageReactions";
import styles from "./MessageBubble.module.css";

type MessageBubbleProps = {
  message: ChatMessageView;
  /** 전송 실패한 메시지를 다시 보낼 때 호출. */
  onRetry?: (() => void) | undefined;
  /** 전송 실패한 메시지를 삭제할 때 호출. */
  onDelete?: (() => void) | undefined;
  /** 삭제된 메시지인지. */
  isDeleted?: boolean;
  /** 수정된 메시지인지 ("수정됨" 표시용). */
  isEdited?: boolean;
  /** 이 메시지에 달린 답글 수. 0이면 답글 표시를 하지 않는다. */
  replyCount?: number;
  /** 오른쪽 패널에 이 메시지의 스레드가 열려있는지. */
  isThreadActive?: boolean;
  /** 말풍선을 눌렀을 때 호출. 답글/수정/삭제는 모두 오른쪽 스레드 패널에서 이뤄진다. */
  onOpenThread?: (() => void) | undefined;
  /** 이모지별 반응 상태. */
  reactions?: MessageReactionsValue;
  /** 반응 이모지를 눌렀을 때 호출(추가/취소 토글). */
  onToggleReaction?: ((emoji: string) => void) | undefined;
  /** 아직 이 메시지를 읽지 않은 인원 수. 0이면 표시하지 않는다. */
  unreadCount?: number;
};

/** 채팅방의 메시지 한 건을 말풍선으로 렌더링한다. 내/상대, 전송 상태에 따라 스타일이 달라진다. */
function MessageBubble({
  message,
  onRetry,
  onDelete,
  isDeleted = false,
  isEdited = false,
  replyCount = 0,
  isThreadActive = false,
  onOpenThread,
  reactions = {},
  onToggleReaction,
  unreadCount = 0,
}: MessageBubbleProps) {
  const isClickable = message.status === "sent" && onOpenThread !== undefined;

  const rowClass = message.isMine ? `${styles.row} ${styles.rowMine}` : styles.row;
  const bubbleClass = [
    styles.bubble,
    message.isMine ? styles.bubbleMine : styles.bubbleOther,
    message.status === "pending" ? styles.bubblePending : "",
    message.status === "failed" ? styles.bubbleFailed : "",
    isDeleted ? styles.bubbleDeleted : "",
    isThreadActive ? styles.bubbleThreadActive : "",
    isClickable ? styles.bubbleClickable : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleDelete = () => {
    if (!window.confirm("메시지를 삭제할까요?")) {
      return;
    }

    onDelete?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenThread?.();
    }
  };

  const showReactions = message.status === "sent" && !isDeleted && onToggleReaction !== undefined;
  const reactionsNode = showReactions ? (
    <MessageReactions reactions={reactions} onToggle={onToggleReaction} isMine={message.isMine} />
  ) : null;

  const unreadCountNode =
    message.status === "sent" && unreadCount > 0 ? (
      <span className={styles.unreadCount}>{unreadCount}</span>
    ) : null;

  return (
    <div className={styles.wrapper}>
      <div className={rowClass}>
        {message.isMine ? unreadCountNode : null}

        <div
          className={bubbleClass}
          onClick={isClickable ? onOpenThread : undefined}
          role={isClickable ? "button" : undefined}
          tabIndex={isClickable ? 0 : undefined}
          onKeyDown={isClickable ? handleKeyDown : undefined}
        >
          {isDeleted ? (
            <span className={styles.deletedText}>삭제된 메시지입니다</span>
          ) : (
            <>
              <span className={styles.text}>{message.text}</span>

              {message.status === "failed" ? (
                <span className={styles.retryRow}>
                  전송 실패
                  <span className={styles.retryDivider} aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={onRetry}
                    aria-label="다시 시도"
                  >
                    <RotateCw size={10} />
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={handleDelete}
                    aria-label="메시지 삭제"
                  >
                    <X size={10} />
                  </button>
                </span>
              ) : (
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
                      : isEdited
                        ? `수정됨 · ${formatTime(message.createdAt)}`
                        : formatTime(message.createdAt)}
                  </span>
                </span>
              )}
            </>
          )}
        </div>

        {message.isMine ? null : unreadCountNode}
      </div>

      {reactionsNode ? (
        <div
          className={
            message.isMine
              ? `${styles.reactionsRow} ${styles.reactionsRowMine}`
              : styles.reactionsRow
          }
        >
          {reactionsNode}
        </div>
      ) : null}
    </div>
  );
}

export default MessageBubble;
