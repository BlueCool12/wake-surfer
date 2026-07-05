import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Send } from "lucide-react";

import Loading from "../../components/Loading";
import { useChatRoom } from "../../features/chat/useChatRoom";
import MessageBubble from "./MessageBubble";
import styles from "./ChatRoomPage.module.css";

function ChatRoomPage() {
  const { channelId = "test" } = useParams();
  const { messages, isLoading, sendMessage } = useChatRoom(channelId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

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
        ) : messages.length === 0 ? (
          <p className={styles.placeholder}>아직 잔잔해요. 첫 파도를 일으켜보세요 🌊</p>
        ) : (
          messages.map((message) => <MessageBubble key={message.key} message={message} />)
        )}
      </div>

      <div className={styles.composer}>
        <div className={styles.inputWrap}>
          <textarea
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
