import { useState } from "react";
import { RotateCw, X } from "lucide-react";

import { MessageBubbleFrameView } from "./MessageBubbleFrameView";
import type { MessageSendFailureViewProps } from "./MessageSendFailureView.types";
import styles from "./MessageBubbleView.module.css";

/** 말풍선으로 여는 하단 메뉴와 열림 상태를 소유한다. 이 표시 방식을 벗어나면 상태도 사라진다. */
export function MessageSendFailureSheetView({
  message,
  isThreadActive,
  onRetry,
  onDiscard,
}: MessageSendFailureViewProps) {
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);

  return (
    <>
      <MessageBubbleFrameView
        message={message}
        isThreadActive={isThreadActive}
        onActivate={() => setIsActionSheetOpen(true)}
      >
        <span className={styles.text}>{message.text}</span>
        <span className={styles.retryRow}>전송 실패</span>
      </MessageBubbleFrameView>

      {isActionSheetOpen ? (
        <div
          className={styles.sheetLayer}
          role="dialog"
          aria-modal="true"
          aria-label="전송 실패한 메시지"
        >
          <button
            type="button"
            className={styles.sheetScrim}
            onClick={() => setIsActionSheetOpen(false)}
            aria-label="닫기"
          />
          <div className={styles.sheet}>
            {onRetry !== undefined ? (
              <button
                type="button"
                className={styles.sheetAction}
                onClick={() => {
                  setIsActionSheetOpen(false);
                  onRetry();
                }}
              >
                <RotateCw size={16} aria-hidden="true" />
                다시 보내기
              </button>
            ) : null}
            {onDiscard !== undefined ? (
              <button
                type="button"
                className={`${styles.sheetAction} ${styles.sheetActionDanger}`}
                onClick={() => {
                  setIsActionSheetOpen(false);
                  onDiscard();
                }}
              >
                <X size={16} aria-hidden="true" />
                삭제
              </button>
            ) : null}
            <button
              type="button"
              className={styles.sheetCancel}
              onClick={() => setIsActionSheetOpen(false)}
            >
              취소
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
