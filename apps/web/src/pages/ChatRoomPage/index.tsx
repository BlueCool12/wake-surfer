import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Send } from "lucide-react";

import Loading from "../../components/Loading";
import { useChatRoom, type ChatMessageView } from "../../features/chat/useChatRoom";
import MessageBubble from "./MessageBubble";
import type { MessageReactionsValue } from "./MessageReactions";
import RoomListSidebar from "./RoomListSidebar";
import ThreadPanel, { type ThreadPanelTab, type ThreadReply } from "./ThreadPanel";
import styles from "./ChatRoomPage.module.css";

function ChatRoomPage() {
  const { channelId = "test" } = useParams();
  const {
    messages,
    isLoading,
    isLoadingOlder,
    olderFailed,
    hasMoreBefore,
    recoveryPhase,
    loadOlder,
    retryRecovery,
    sendMessage,
    retryMessage,
  } = useChatRoom(channelId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 답글/스레드/수정/삭제는 백엔드에 개념이 없어(chat-backend-contract 참고) 이 화면 세션 안에서만 유지되는 로컬 상태다.
  const [threadsByMessageKey, setThreadsByMessageKey] = useState<Record<string, ThreadReply[]>>({});
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | undefined>(undefined);
  const [panelTab, setPanelTab] = useState<ThreadPanelTab>("thread");
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [messageEdits, setMessageEdits] = useState<Record<string, string>>({});
  const [deletedMessageKeys, setDeletedMessageKeys] = useState<Record<string, true>>({});
  const [reactionsByMessageKey, setReactionsByMessageKey] = useState<
    Record<string, MessageReactionsValue>
  >({});

  const resolveMessage = (message: ChatMessageView): ChatMessageView => {
    const editedText = messageEdits[message.key];
    return editedText === undefined ? message : { ...message, text: editedText };
  };

  const rawThreadParent = messages.find((message) => message.key === selectedThreadKey);
  const selectedThreadParent = rawThreadParent === undefined ? undefined : resolveMessage(rawThreadParent);
  const isSelectedThreadParentDeleted =
    selectedThreadKey !== undefined && Boolean(deletedMessageKeys[selectedThreadKey]);
  const isSelectedThreadParentEdited =
    selectedThreadKey !== undefined && messageEdits[selectedThreadKey] !== undefined;
  const selectedThreadReplies =
    selectedThreadKey !== undefined ? (threadsByMessageKey[selectedThreadKey] ?? []) : [];

  const handleOpenThread = (messageKey: string) => {
    setSelectedThreadKey(messageKey);
    setPanelTab("thread");
    setIsPanelCollapsed(false);
  };

  const handleAddReply = (text: string) => {
    if (selectedThreadKey === undefined) return;

    const reply: ThreadReply = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString(),
    };
    setThreadsByMessageKey((prev) => ({
      ...prev,
      [selectedThreadKey]: [...(prev[selectedThreadKey] ?? []), reply],
    }));
  };

  const handleEditMessage = (messageKey: string, text: string) => {
    setMessageEdits((prev) => ({ ...prev, [messageKey]: text }));
  };

  const handleDeleteMessage = (messageKey: string) => {
    setDeletedMessageKeys((prev) => ({ ...prev, [messageKey]: true }));
  };

  const handleToggleReaction = (messageKey: string, emoji: string) => {
    setReactionsByMessageKey((prev) => {
      const current = prev[messageKey] ?? {};
      const wasReacted = current[emoji]?.reactedByMe ?? false;
      const nextCount = (current[emoji]?.count ?? 0) + (wasReacted ? -1 : 1);

      const nextMessageReactions = { ...current };
      if (nextCount <= 0) {
        delete nextMessageReactions[emoji];
      } else {
        nextMessageReactions[emoji] = { count: nextCount, reactedByMe: !wasReacted };
      }

      return { ...prev, [messageKey]: nextMessageReactions };
    });
  };

  // 입력 내용에 따라 textarea 높이를 늘린다(최대 높이는 CSS max-height 가 제한).
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el === null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 100;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const isMineLatest = messages.at(-1)?.isMine ?? false;
    if (!isAtBottomRef.current && !isMineLatest) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (draft.trim() === "") return;
    sendMessage(draft);
    setDraft("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.shell}>
      <RoomListSidebar channelId={channelId} />

      <div
        className={
          isPanelCollapsed ? `${styles.mainArea} ${styles.mainAreaPanelCollapsed}` : styles.mainArea
        }
      >
      <header className={styles.header}>
        <span className={styles.channelHash}>#</span>
        <h1 className={styles.channelName}>{channelId}</h1>
      </header>

      <div className={styles.page}>
        <div className={styles.messages} ref={scrollRef} onScroll={handleScroll}>
          {isLoading ? (
            <Loading />
          ) : (
            <>
              {hasMoreBefore ? (
                <button type="button" className={styles.loadOlder} onClick={loadOlder}>
                  {isLoadingOlder
                    ? "이전 메시지 불러오는 중…"
                    : olderFailed
                      ? "이전 메시지 다시 불러오기"
                      : "이전 메시지 불러오기"}
                </button>
              ) : null}
              {recoveryPhase === "recovery_pending" ? (
                <p className={styles.recoveryNotice}>누락된 메시지를 이어서 복구하고 있어요.</p>
              ) : recoveryPhase === "retryable_failure" ? (
                <button type="button" className={styles.recoveryNotice} onClick={retryRecovery}>
                  연결이 잠시 끊겼어요. 복구 시도하기
                </button>
              ) : recoveryPhase === "stream_unavailable" ||
                recoveryPhase === "invalid_cursor" ||
                recoveryPhase === "authentication_failure" ||
                recoveryPhase === "protocol_failure" ? (
                <p className={styles.recoveryError}>메시지 기록을 안전하게 불러오지 못했어요.</p>
              ) : null}
              {messages.length === 0 ? (
                <p className={styles.placeholder}>아직 잔잔해요. 첫 파도를 일으켜보세요 🌊</p>
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.key}
                    message={resolveMessage(message)}
                    onRetry={message.status === "failed" ? () => retryMessage(message) : undefined}
                    onDelete={message.status === "failed" ? () => handleDeleteMessage(message.key) : undefined}
                    isDeleted={Boolean(deletedMessageKeys[message.key])}
                    isEdited={messageEdits[message.key] !== undefined}
                    replyCount={threadsByMessageKey[message.key]?.length ?? 0}
                    isThreadActive={message.key === selectedThreadKey}
                    onOpenThread={() => handleOpenThread(message.key)}
                    reactions={reactionsByMessageKey[message.key] ?? {}}
                    onToggleReaction={(emoji) => handleToggleReaction(message.key, emoji)}
                  />
                ))
              )}
            </>
          )}
        </div>

        <div className={styles.composer}>
          <div className={styles.inputWrap}>
            <textarea
              ref={textareaRef}
              className={styles.input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`#${channelId}에 메시지 보내기`}
              rows={1}
            />
            <button
              type="button"
              className={styles.sendButton}
              onClick={handleSend}
              disabled={draft.trim() === ""}
              aria-label="전송"
            >
              <Send size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <ThreadPanel
        activeTab={panelTab}
        onTabChange={setPanelTab}
        parentMessage={selectedThreadParent}
        isParentDeleted={isSelectedThreadParentDeleted}
        isParentEdited={isSelectedThreadParentEdited}
        onEditParent={(text) => {
          if (selectedThreadKey !== undefined) handleEditMessage(selectedThreadKey, text);
        }}
        onDeleteParent={() => {
          if (selectedThreadKey !== undefined) handleDeleteMessage(selectedThreadKey);
        }}
        replies={selectedThreadReplies}
        onAddReply={handleAddReply}
        isCollapsed={isPanelCollapsed}
        onCollapsedChange={setIsPanelCollapsed}
      />
      </div>
    </div>
  );
}

export { ChatRoomPage as Component };
