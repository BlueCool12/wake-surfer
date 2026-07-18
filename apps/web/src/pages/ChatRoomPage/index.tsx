import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Send } from "lucide-react";

import Loading from "../../components/Loading";
import { useChatRoom } from "../../features/chat/useChatRoom";
import MessageBubble from "./MessageBubble";
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
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.channelHash}>#</span>
        <h1 className={styles.channelName}>{channelId}</h1>
      </header>

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
                연결이 잠시 끊겼어요. 복구를 다시 시도하기
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
                  message={message}
                  onRetry={message.status === "failed" ? () => retryMessage(message) : undefined}
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
  );
}

export { ChatRoomPage as Component };
