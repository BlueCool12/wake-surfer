import type { ChatMessageView } from "../../../features/chat/useChatChannel";
import MessageReactionsView, { type MessageReactionsValue } from "./MessageReactionsView";
import { MessageBubbleFrameView } from "./MessageBubbleFrameView";
import { MessageMetadataView } from "./MessageMetadataView";
import { MessageSendFailureView } from "./MessageSendFailureView";
import styles from "./MessageBubbleView.module.css";

type MessageBubbleViewProps = {
  message: ChatMessageView;
  /** 전송 실패한 메시지를 다시 보낼 때 호출. */
  onRetry?: (() => void) | undefined;
  /** 전송 실패한 메시지를 삭제할 때 호출. */
  onDiscard?: (() => void) | undefined;
  /** 이 메시지에 달린 답글 수. 0이면 답글 표시를 하지 않는다. */
  replyCount?: number;
  /** 오른쪽 패널에 이 메시지의 스레드가 열려있는지. */
  isThreadActive?: boolean;
  /** 말풍선을 눌렀을 때 호출. 답글/수정/삭제는 모두 오른쪽 스레드 패널에서 이뤄진다. */
  onOpenThread?: (() => void) | undefined;
  /** 이모지별 반응 상태. */
  reactions?: MessageReactionsValue;
  /** 반응 이모지를 눌렀을 때 호출(추가/취소 토글). */
  onToggleReaction?: ((emoji: string) => void) | undefined;
  /** 아직 이 메시지를 읽지 않은 인원 수. 0이면 표시하지 않는다. */
  unreadCount?: number;
};

/** 메시지 한 건의 말풍선과 읽음·반응 정보를 배치한다. */
function MessageBubbleView({
  message,
  onRetry,
  onDiscard,
  replyCount = 0,
  isThreadActive = false,
  onOpenThread,
  reactions = {},
  onToggleReaction,
  unreadCount = 0,
}: MessageBubbleViewProps) {
  const rowClass = message.isMine ? `${styles.row} ${styles.rowMine}` : styles.row;
  const unreadCountNode =
    message.status === "sent" && unreadCount > 0 ? (
      <span className={styles.unreadCount}>{unreadCount}</span>
    ) : null;

  return (
    <div className={styles.wrapper}>
      <div className={rowClass}>
        {message.isMine ? unreadCountNode : null}

        {message.status === "failed" && !message.isDeleted ? (
          <MessageSendFailureView
            key={message.key}
            message={message}
            isThreadActive={isThreadActive}
            onRetry={onRetry}
            onDiscard={onDiscard}
          />
        ) : (
          <MessageBubbleFrameView
            message={message}
            isThreadActive={isThreadActive}
            onActivate={onOpenThread}
          >
            {message.isDeleted ? (
              <span className={styles.deletedText}>삭제된 메시지입니다</span>
            ) : (
              <>
                <span className={styles.text}>{message.text}</span>
                <MessageMetadataView message={message} replyCount={replyCount} />
              </>
            )}
          </MessageBubbleFrameView>
        )}

        {message.isMine ? null : unreadCountNode}
      </div>

      {onToggleReaction !== undefined ? (
        <div
          className={
            message.isMine
              ? `${styles.reactionsRow} ${styles.reactionsRowMine}`
              : styles.reactionsRow
          }
        >
          <MessageReactionsView
            reactions={reactions}
            onToggle={onToggleReaction}
            isMine={message.isMine}
          />
        </div>
      ) : null}
    </div>
  );
}

export default MessageBubbleView;
