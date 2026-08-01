import { useState } from "react";
import { Check, Pencil, RotateCw, X } from "lucide-react";

import type { ChatMessageView } from "../../features/chat/useChatRoom";
import { formatTime } from "../../utils/date";
import styles from "./MessageBubble.module.css";

type MessageBubbleProps = {
  message: ChatMessageView;
  /** 전송 실패한 메시지를 다시 보낼 때 호출. */
  onRetry?: (() => void) | undefined;
  /** 메시지 수정을 저장할 때 호출. 새 텍스트를 전달한다. */
  onEdit?: ((text: string) => void) | undefined;
  /** 메시지를 삭제할 때 호출. */
  onDelete?: (() => void) | undefined;
};

/** 채팅방의 메시지 한 건을 말풍선으로 렌더링한다. 내/상대, 전송 상태에 따라 스타일이 달라진다. */
function MessageBubble({ message, onRetry, onEdit, onDelete }: MessageBubbleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const [editedText, setEditedText] = useState<string | undefined>(undefined);
  const [isDeleted, setIsDeleted] = useState(false);

  const canModify = message.isMine && message.status === "sent" && !isDeleted;
  const displayText = editedText ?? message.text;

  const rowClass = message.isMine ? `${styles.row} ${styles.rowMine}` : styles.row;
  const bubbleClass = [
    styles.bubble,
    message.isMine ? styles.bubbleMine : styles.bubbleOther,
    message.status === "pending" ? styles.bubblePending : "",
    message.status === "failed" ? styles.bubbleFailed : "",
    isDeleted ? styles.bubbleDeleted : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleEditStart = () => {
    setDraft(displayText);
    setIsEditing(true);
  };

  const handleEditCancel = () => {
    setIsEditing(false);
  };

  const handleEditSave = () => {
    const trimmed = draft.trim();

    if (trimmed.length === 0) {
      return;
    }

    setEditedText(trimmed);
    onEdit?.(trimmed);
    setIsEditing(false);
  };

  const handleEditKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleEditSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleEditCancel();
    }
  };

  const handleDelete = () => {
    if (!window.confirm("메시지를 삭제할까요?")) {
      return;
    }

    onDelete?.();
    setIsDeleted(true);
  };

  return (
    <div className={rowClass}>
      <div className={bubbleClass}>
        {isDeleted ? (
          <span className={styles.deletedText}>삭제된 메시지입니다</span>
        ) : (
          <>
            <span className={styles.metaText}>
              {message.status === "pending"
                ? "전송 중…"
                : editedText !== undefined
                  ? `수정됨 · ${formatTime(message.createdAt)}`
                  : formatTime(message.createdAt)}
            </span>

            {isEditing ? (
              <span className={styles.editRow}>
                <textarea
                  className={styles.editInput}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleEditKeyDown}
                  rows={1}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={handleEditSave}
                  aria-label="수정 저장"
                >
                  <Check size={10} />
                </button>
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={handleEditCancel}
                  aria-label="수정 취소"
                >
                  <X size={10} />
                </button>
              </span>
            ) : (
              <span className={styles.text}>{displayText}</span>
            )}

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
            ) : canModify && !isEditing ? (
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={handleEditStart}
                  aria-label="메시지 수정"
                >
                  <Pencil size={10} />
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
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
