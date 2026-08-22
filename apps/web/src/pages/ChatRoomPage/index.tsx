import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Menu, PanelRight, Send } from "lucide-react";

import Loading from "../../components/Loading";
import ThemeToggle from "../../components/ThemeToggle";
import { useChatRoom, type ChatMessageView } from "../../features/chat/useChatRoom";
import useVisualViewportHeight from "../../hooks/useVisualViewportHeight";
import MentionPicker from "./MentionPicker";
import MessageBubble from "./MessageBubble";
import type { MessageReactionsValue } from "./MessageReactions";
import RoomListSidebar from "./RoomListSidebar";
import ThreadPanel, { type RoomMember, type ThreadPanelTab, type ThreadReply } from "./ThreadPanel";
import { createChatComposerSubmitController } from "./chatComposerKeyPolicy";
import styles from "./ChatRoomPage.module.css";

/** 커서 바로 앞에서 진행 중인 "@닉네임" 멘션 입력을 찾는다. 공백/줄바꿈이 나오면 멘션 입력이 끝난 것으로 본다. */
function findMentionQuery(value: string, cursor: number): string | undefined {
  const beforeCursor = value.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
  return match?.[1];
}

// 방 멤버 목록/인원수 API가 아직 없어(chat-backend-contract 참고) 고정값으로 mock한다.
const ROOM_MEMBERS: RoomMember[] = [
  { id: "user-me", name: "나", isOnline: true },
  { id: "user-alice", name: "Alice", isOnline: true },
  { id: "user-bob", name: "Bob", isOnline: false },
  { id: "user-carol", name: "Carol", isOnline: true },
  { id: "user-dan", name: "Dan", isOnline: false },
];

function ChatRoomPage() {
  const { channelId = "test" } = useParams();
  useVisualViewportHeight();
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
  const submitControllerRef = useRef(createChatComposerSubmitController());
  const [isDraftMultiline, setIsDraftMultiline] = useState(false);
  const singleLineHeightRef = useRef<number | undefined>(undefined);

  // "@"로 멘션할 멤버를 고르는 팝업. 백엔드에 멘션 개념이 없어 텍스트에 이름을 끼워 넣는 UI만 구현한다.
  const [mentionQuery, setMentionQuery] = useState<string | undefined>(undefined);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const mentionMatches =
    mentionQuery === undefined
      ? []
      : ROOM_MEMBERS.filter((member) =>
          member.name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
        );
  const isMentionOpen = mentionQuery !== undefined && mentionMatches.length > 0;

  // 답글/스레드/수정/삭제는 백엔드에 개념이 없어(chat-backend-contract 참고) 이 화면 세션 안에서만 유지되는 로컬 상태다.
  const [threadsByMessageKey, setThreadsByMessageKey] = useState<Record<string, ThreadReply[]>>({});
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | undefined>(undefined);
  const [panelTab, setPanelTab] = useState<ThreadPanelTab>("thread");
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  // 좁은 화면 전용 상태. 넓은 화면에서는 CSS 가 이 상태를 무시한다.
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isPanelOverlayOpen, setIsPanelOverlayOpen] = useState(false);
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
  const selectedThreadParent =
    rawThreadParent === undefined ? undefined : resolveMessage(rawThreadParent);
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
    setIsPanelOverlayOpen(true);
  };

  const handleOpenPanel = () => {
    setIsPanelCollapsed(false);
    setIsPanelOverlayOpen(true);
  };

  const closeThreadPanel = () => {
    setIsPanelOverlayOpen(false);
    setSelectedThreadKey(undefined);
  };

  const closeOverlays = () => {
    setIsDrawerOpen(false);
    closeThreadPanel();
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
    // 첫 측정은 빈 입력이라 한 줄 높이다.
    singleLineHeightRef.current ??= el.scrollHeight;
    el.style.height = `${el.scrollHeight}px`;
    setIsDraftMultiline(el.scrollHeight > singleLineHeightRef.current);
  }, [draft]);

  useEffect(() => {
    if (!isDrawerOpen && !isPanelOverlayOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsDrawerOpen(false);
      setIsPanelOverlayOpen(false);
      setSelectedThreadKey(undefined);
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isDrawerOpen, isPanelOverlayOpen]);

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

  const handleSend = (text: string) => {
    submitControllerRef.current.cancelPendingSubmit();
    if (text.trim() === "") return;
    sendMessage(text);
    setDraft("");
    setMentionQuery(undefined);
  };

  const handleDraftChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft(value);
    setMentionQuery(findMentionQuery(value, event.target.selectionStart));
    setMentionActiveIndex(0);
  };

  const handleSelectMention = (member: RoomMember) => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor).replace(/@([^\s@]*)$/, `@${member.name} `);
    const after = draft.slice(cursor);
    setDraft(before + after);
    setMentionQuery(undefined);

    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const submitController = submitControllerRef.current;

    if (isMentionOpen) {
      if (submitController.isImeProcessing(event.nativeEvent)) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index + 1) % mentionMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionActiveIndex(
          (index) => (index - 1 + mentionMatches.length) % mentionMatches.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const activeMember = mentionMatches[mentionActiveIndex];
        if (activeMember !== undefined) handleSelectMention(activeMember);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionQuery(undefined);
        return;
      }
    }

    const result = submitController.handleKeyDown(event.nativeEvent);
    if (result.shouldPreventDefault) event.preventDefault();
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!submitControllerRef.current.consumeSubmitOnKeyUp(event.nativeEvent)) return;
    handleSend(event.currentTarget.value);
  };

  return (
    <div className={styles.shell}>
      <RoomListSidebar
        channelId={channelId}
        className={isDrawerOpen ? `${styles.drawer} ${styles.drawerOpen}` : styles.drawer}
      />

      {isDrawerOpen || isPanelOverlayOpen ? (
        <button
          type="button"
          className={styles.scrim}
          onClick={closeOverlays}
          aria-label="닫기"
          tabIndex={-1}
        />
      ) : null}

      <div
        className={
          isPanelCollapsed ? `${styles.mainArea} ${styles.mainAreaPanelCollapsed}` : styles.mainArea
        }
      >
        <header className={styles.header}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setIsDrawerOpen(true)}
            aria-label="방 목록 열기"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <span className={styles.channelHash}>#</span>
          <h1 className={styles.channelName}>{channelId}</h1>
          <ThemeToggle className={styles.themeToggle} />
          <button
            type="button"
            className={styles.iconButton}
            onClick={handleOpenPanel}
            aria-label="스레드 패널 열기"
          >
            <PanelRight size={18} aria-hidden="true" />
          </button>
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
                      onRetry={
                        message.status === "failed" ? () => retryMessage(message) : undefined
                      }
                      onDelete={
                        message.status === "failed"
                          ? () => handleDeleteMessage(message.key)
                          : undefined
                      }
                      isDeleted={Boolean(deletedMessageKeys[message.key])}
                      isEdited={messageEdits[message.key] !== undefined}
                      replyCount={threadsByMessageKey[message.key]?.length ?? 0}
                      isThreadActive={message.key === selectedThreadKey}
                      onOpenThread={() => handleOpenThread(message.key)}
                      reactions={reactionsByMessageKey[message.key] ?? {}}
                      onToggleReaction={(emoji) => handleToggleReaction(message.key, emoji)}
                      unreadCount={Math.max(ROOM_MEMBERS.length - 1, 0)}
                    />
                  ))
                )}
              </>
            )}
          </div>

          <div className={styles.composer}>
            {isMentionOpen ? (
              <MentionPicker
                members={mentionMatches}
                activeIndex={mentionActiveIndex}
                onSelect={handleSelectMention}
              />
            ) : null}
            <div
              className={
                isDraftMultiline
                  ? `${styles.inputWrap} ${styles.inputWrapMultiline}`
                  : styles.inputWrap
              }
            >
              <textarea
                ref={textareaRef}
                className={styles.input}
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onCompositionStart={() => submitControllerRef.current.compositionStarted()}
                onCompositionEnd={() => submitControllerRef.current.compositionEnded()}
                onBlur={() => submitControllerRef.current.cancelPendingSubmit()}
                placeholder={`#${channelId}에 메시지 보내기`}
                rows={1}
              />
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => handleSend(draft)}
                disabled={draft.trim() === ""}
                aria-label="전송"
              >
                <Send size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <ThreadPanel
          className={isPanelOverlayOpen ? `${styles.panel} ${styles.panelOpen}` : styles.panel}
          onClose={closeThreadPanel}
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
          members={ROOM_MEMBERS}
          isCollapsed={isPanelCollapsed}
          onCollapsedChange={setIsPanelCollapsed}
        />
      </div>
    </div>
  );
}

export { ChatRoomPage as Component };
