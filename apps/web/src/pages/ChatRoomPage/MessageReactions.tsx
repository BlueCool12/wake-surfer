import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";

import styles from "./MessageReactions.module.css";

export type MessageReactionState = {
  count: number;
  reactedByMe: boolean;
};

export type MessageReactionsValue = Record<string, MessageReactionState>;

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type MessageReactionsProps = {
  reactions: MessageReactionsValue;
  onToggle: (emoji: string) => void;
  /** 내 메시지인지. 반응 추가 버튼이 항상 말풍선과 붙는(안쪽) 자리에 오도록 순서를 정하는 데 쓴다. */
  isMine: boolean;
};

/** 말풍선 옆(내 메시지는 왼쪽, 상대 메시지는 오른쪽)에 붙는 반응(이모지) pill과 추가 버튼. */
function MessageReactions({ reactions, onToggle, isMine }: MessageReactionsProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const entries = Object.entries(reactions).filter(([, state]) => state.count > 0);

  // wrap 안(= 추가 버튼)은 제외한다. 여기서 같이 닫으면 버튼의 토글과 겹쳐 다시 열린다.
  useEffect(() => {
    if (!isPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && pickerWrapRef.current?.contains(target) === true) return;
      setIsPickerOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isPickerOpen]);

  const pills = entries.map(([emoji, state]) => (
    <button
      key={emoji}
      type="button"
      className={state.reactedByMe ? `${styles.pill} ${styles.pillActive}` : styles.pill}
      onClick={() => onToggle(emoji)}
      aria-label={`${emoji} 반응 ${state.reactedByMe ? "취소" : "추가"}`}
    >
      <span aria-hidden="true">{emoji}</span>
      {state.count}
    </button>
  ));

  const trigger = (
    <div className={styles.pickerWrap} ref={pickerWrapRef}>
      <button
        type="button"
        className={styles.addButton}
        onClick={() => setIsPickerOpen((open) => !open)}
        aria-label="반응 추가"
      >
        <SmilePlus size={13} />
      </button>

      {isPickerOpen ? (
        <div className={isMine ? `${styles.picker} ${styles.pickerMine}` : styles.picker}>
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={styles.pickerEmoji}
              onClick={() => {
                onToggle(emoji);
                setIsPickerOpen(false);
              }}
              aria-label={`${emoji} 반응 추가`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={styles.row}>
      {/* 반응 추가 버튼이 항상 말풍선에 붙는 쪽에 오도록: 내 메시지(말풍선이 오른쪽)는 뒤에, 상대 메시지(말풍선이 왼쪽)는 앞에 둔다. */}
      {isMine ? (
        <>
          {pills}
          {trigger}
        </>
      ) : (
        <>
          {trigger}
          {pills}
        </>
      )}
    </div>
  );
}

export default MessageReactions;
