import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Pencil, Send, X } from "lucide-react";
import { formatTime } from "../../../utils/date";
import type { ChatMessageView } from "../../../features/chat/useChatChannel";
import styles from "./ThreadPanelView.module.css";

export function ThreadConversationView({
  parentMessage,
  onEditParent,
  onDeleteParent,
  onAddReply,
  replies,
  visible,
}: {
  parentMessage: ChatMessageView;
  onEditParent: ((text: string) => void) | undefined;
  onDeleteParent: (() => void) | undefined;
  onAddReply: (text: string) => void;
  replies: ReactNode;
  visible: boolean;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditingParent, setIsEditingParent] = useState(false);
  const [parentDraft, setParentDraft] = useState("");

  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, visible]);

  const handleSend = () => {
    if (draft.trim() === "") return;
    onAddReply(draft.trim());
    setDraft("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleEditParentStart = () => {
    setParentDraft(parentMessage.text);
    setIsEditingParent(true);
  };

  const handleEditParentSave = () => {
    const trimmed = parentDraft.trim();
    if (trimmed.length === 0) return;
    onEditParent?.(trimmed);
    setIsEditingParent(false);
  };

  const handleEditParentKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleEditParentSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsEditingParent(false);
    }
  };

  const handleDeleteParent = () => {
    if (!window.confirm("메시지를 삭제할까요?")) return;
    onDeleteParent?.();
  };

  const parentTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = parentTextareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [parentDraft, isEditingParent, visible]);
  if (!visible) return null;
  return (
    <>
      <div className={styles.parentMessage}>
        {parentMessage.isDeleted ? (
          <span className={styles.deletedText}>삭제된 메시지입니다</span>
        ) : isEditingParent ? (
          <textarea
            ref={parentTextareaRef}
            className={styles.parentTextInput}
            value={parentDraft}
            onChange={(event) => setParentDraft(event.target.value)}
            onKeyDown={handleEditParentKeyDown}
            rows={1}
            autoFocus
          />
        ) : (
          <span className={styles.parentText}>{parentMessage.text}</span>
        )}
        {parentMessage.isDeleted ? null : (
          <span className={styles.parentMetaRow}>
            <span className={styles.parentMeta}>
              {parentMessage.isEdited
                ? `수정됨 · ${formatTime(parentMessage.createdAt)}`
                : formatTime(parentMessage.createdAt)}
            </span>
            {onEditParent !== undefined || onDeleteParent !== undefined ? (
              <span className={styles.parentActions}>
                {isEditingParent && onEditParent !== undefined ? (
                  <>
                    <button
                      type="button"
                      className={styles.editButton}
                      onClick={handleEditParentSave}
                      aria-label="수정 저장"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      className={styles.editButton}
                      onClick={() => setIsEditingParent(false)}
                      aria-label="수정 취소"
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    {onEditParent !== undefined ? (
                      <button
                        type="button"
                        className={styles.editButton}
                        onClick={handleEditParentStart}
                        aria-label="메시지 수정"
                      >
                        <Pencil size={12} />
                      </button>
                    ) : null}
                    {onDeleteParent !== undefined ? (
                      <button
                        type="button"
                        className={styles.editButton}
                        onClick={handleDeleteParent}
                        aria-label="메시지 삭제"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            ) : null}
          </span>
        )}
      </div>

      {replies}

      <div className={styles.composer}>
        <div className={styles.replyInputWrap}>
          <textarea
            ref={textareaRef}
            className={styles.replyInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="답글 남기기"
            rows={1}
          />
          <button
            type="button"
            className={styles.replySendButton}
            onClick={handleSend}
            disabled={draft.trim() === ""}
            aria-label="답글 전송"
          >
            <Send size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  );
}
