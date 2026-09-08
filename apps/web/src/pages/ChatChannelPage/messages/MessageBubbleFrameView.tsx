import type { KeyboardEvent, ReactNode } from "react";

import type { ChatMessageView } from "../../../features/chat/useChatChannel";
import styles from "./MessageBubbleView.module.css";

/** 말풍선의 모양과 클릭·키보드 입력을 연결한다. 클릭으로 수행할 동작은 바깥에서 정한다. */
export function MessageBubbleFrameView({
  message,
  isThreadActive,
  onActivate,
  children,
}: {
  message: ChatMessageView;
  isThreadActive: boolean;
  onActivate?: (() => void) | undefined;
  children: ReactNode;
}) {
  const isClickable = onActivate !== undefined;
  const bubbleClass = [
    styles.bubble,
    // 이 메세지 객체라고 해야할까 판단 위임을 좀 해야할듯
    message.isMine ? styles.bubbleMine : styles.bubbleOther,
    message.status === "pending" ? styles.bubblePending : "",
    message.status === "failed" ? styles.bubbleFailed : "",
    message.isDeleted ? styles.bubbleDeleted : "",
    isThreadActive ? styles.bubbleThreadActive : "",
    isClickable ? styles.bubbleClickable : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate?.();
    }
  };

  return (
    <div
      className={bubbleClass}
      onClick={onActivate}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
    >
      {children}
    </div>
  );
}
