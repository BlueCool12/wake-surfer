import { useEffect, useRef, useState } from "react";
import {
  Check,
  MessagesSquare,
  PanelRightClose,
  Pencil,
  Send,
  StickyNote,
  Users,
  X,
} from "lucide-react";

import { formatTime } from "../../utils/date";
import type { ChatMessageView } from "../../features/chat/useChatRoom";
import styles from "./ThreadPanel.module.css";

export type ThreadReply = {
  id: string;
  text: string;
  createdAt: string;
};

export type RoomMember = {
  id: string;
  name: string;
  isOnline: boolean;
};

export type ThreadPanelTab = "thread" | "members" | "memo";

type ThreadPanelProps = {
  /** 부모가 정하는 배치용 클래스(좁은 화면에서는 전체 화면 오버레이). */
  className?: string | undefined;
  /** 오버레이를 닫을 때 호출. 넓은 화면에서는 닫기 버튼이 숨겨진다. */
  onClose: () => void;
  activeTab: ThreadPanelTab;
  onTabChange: (tab: ThreadPanelTab) => void;
  parentMessage: ChatMessageView | undefined;
  isParentDeleted: boolean;
  isParentEdited: boolean;
  onEditParent: (text: string) => void;
  onDeleteParent: () => void;
  replies: ThreadReply[];
  onAddReply: (text: string) => void;
  members: RoomMember[];
  isCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/** 채팅방 오른쪽에 고정되는 스레드/멤버/메모 패널. 백엔드에 스레드 개념이 없어 답글은 이 화면 안에서만 유지된다. */
function ThreadPanel({
  className,
  onClose,
  activeTab,
  onTabChange,
  parentMessage,
  isParentDeleted,
  isParentEdited,
  onEditParent,
  onDeleteParent,
  replies,
  onAddReply,
  members,
  isCollapsed,
  onCollapsedChange,
}: ThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditingParent, setIsEditingParent] = useState(false);
  const [parentDraft, setParentDraft] = useState("");

  useEffect(() => {
    setDraft("");
    setIsEditingParent(false);
  }, [parentMessage?.key]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

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

  const canModifyParent =
    parentMessage !== undefined &&
    parentMessage.isMine &&
    parentMessage.status === "sent" &&
    !isParentDeleted;

  const handleEditParentStart = () => {
    if (parentMessage === undefined) return;
    setParentDraft(parentMessage.text);
    setIsEditingParent(true);
  };

  const handleEditParentSave = () => {
    const trimmed = parentDraft.trim();
    if (trimmed.length === 0) return;
    onEditParent(trimmed);
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
    onDeleteParent();
  };

  const panelClass = className === undefined ? styles.panel : `${styles.panel} ${className}`;

  if (isCollapsed) {
    return (
      <aside className={panelClass}>
        <div className={styles.rail}>
          <button
            type="button"
            className={styles.tab}
            onClick={() => {
              onCollapsedChange(false);
              onTabChange("thread");
            }}
            aria-label="스레드 패널 펼치기"
          >
            <MessagesSquare size={16} />
            <span className={styles.tooltip}>스레드</span>
          </button>
          <button
            type="button"
            className={styles.tab}
            onClick={() => {
              onCollapsedChange(false);
              onTabChange("memo");
            }}
            aria-label="메모 패널 펼치기"
          >
            <StickyNote size={16} />
            <span className={styles.tooltip}>메모</span>
          </button>
          <button
            type="button"
            className={styles.tab}
            onClick={() => {
              onCollapsedChange(false);
              onTabChange("members");
            }}
            aria-label="멤버 패널 펼치기"
          >
            <Users size={16} />
            <span className={styles.tooltip}>멤버</span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={panelClass}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={activeTab === "thread" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => onTabChange("thread")}
          aria-label="스레드"
        >
          <MessagesSquare size={16} />
          <span className={styles.tooltip}>스레드</span>
        </button>
        <button
          type="button"
          className={activeTab === "memo" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => onTabChange("memo")}
          aria-label="메모"
        >
          <StickyNote size={16} />
          <span className={styles.tooltip}>메모</span>
        </button>
        <button
          type="button"
          className={activeTab === "members" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => onTabChange("members")}
          aria-label="멤버"
        >
          <Users size={16} />
          <span className={styles.tooltip}>멤버</span>
        </button>

        <button
          type="button"
          className={`${styles.tab} ${styles.tabsEnd} ${styles.collapseButton}`}
          onClick={() => onCollapsedChange(true)}
          aria-label="패널 접기"
        >
          <PanelRightClose size={16} />
          <span className={styles.tooltip}>접기</span>
        </button>

        <button
          type="button"
          className={`${styles.tab} ${styles.tabsEnd} ${styles.closeButton}`}
          onClick={onClose}
          aria-label="패널 닫기"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {activeTab === "members" ? (
        <div className={styles.memberList}>
          {[
            { label: "온라인", members: members.filter((member) => member.isOnline) },
            { label: "오프라인", members: members.filter((member) => !member.isOnline) },
          ].map((group) =>
            group.members.length === 0 ? null : (
              <div key={group.label} className={styles.memberGroup}>
                <p className={styles.memberGroupLabel}>
                  {group.label} {group.members.length}
                </p>
                <ul className={styles.memberGroupList}>
                  {group.members.map((member) => (
                    <li key={member.id} className={styles.member}>
                      <span className={styles.memberAvatarWrap}>
                        <span className={styles.memberAvatar} aria-hidden="true">
                          {member.name.slice(0, 1)}
                        </span>
                        <span
                          className={
                            member.isOnline
                              ? `${styles.memberStatusDot} ${styles.memberStatusDotOnline}`
                              : styles.memberStatusDot
                          }
                          aria-hidden="true"
                        />
                      </span>
                      <span
                        className={
                          member.isOnline
                            ? styles.memberName
                            : `${styles.memberName} ${styles.memberNameOffline}`
                        }
                      >
                        {member.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      ) : activeTab === "memo" ? (
        <div className={styles.emptyState}>
          <p>메모 기능은 아직 준비 중이에요.</p>
        </div>
      ) : parentMessage === undefined ? (
        <div className={styles.emptyState}>
          <p>채팅 메시지를 눌러 스레드를 시작해보세요.</p>
        </div>
      ) : (
        <>
          <div className={styles.parentMessage}>
            {isParentDeleted ? (
              <span className={styles.deletedText}>삭제된 메시지입니다</span>
            ) : isEditingParent ? (
              <textarea
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
            {isParentDeleted ? null : (
              <span className={styles.parentMetaRow}>
                <span className={styles.parentMeta}>
                  {isParentEdited
                    ? `수정됨 · ${formatTime(parentMessage.createdAt)}`
                    : formatTime(parentMessage.createdAt)}
                </span>
                {canModifyParent ? (
                  <span className={styles.parentActions}>
                    {isEditingParent ? (
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
                        <button
                          type="button"
                          className={styles.editButton}
                          onClick={handleEditParentStart}
                          aria-label="메시지 수정"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          className={styles.editButton}
                          onClick={handleDeleteParent}
                          aria-label="메시지 삭제"
                        >
                          <X size={12} />
                        </button>
                      </>
                    )}
                  </span>
                ) : null}
              </span>
            )}
          </div>

          <div className={styles.replyList}>
            {replies.length === 0 ? (
              <p className={styles.replyPlaceholder}>아직 답글이 없어요.</p>
            ) : (
              replies.map((reply) => (
                <div key={reply.id} className={styles.reply}>
                  <span className={styles.replyText}>{reply.text}</span>
                  <span className={styles.replyMeta}>{formatTime(reply.createdAt)}</span>
                </div>
              ))
            )}
          </div>

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
      )}
    </aside>
  );
}

export default ThreadPanel;
