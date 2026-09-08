import type { ChatMessageView } from "../../features/chat/useChatChannel";

// 표시할 동작을 결정한다. 실행 시점의 유효성 검사는 기존 세션이 계속 담당한다.
export function getMessageActionAvailability(
  message: Pick<ChatMessageView, "status" | "isMine" | "isDeleted"> | undefined,
) {
  const isSent = message?.status === "sent";
  const isVisibleFailure = message?.status === "failed" && !message.isDeleted;
  const canReact = isSent && message?.isDeleted === false;
  const canModify = canReact && message?.isMine === true;

  return {
    canRetry: isVisibleFailure,
    canDiscard: isVisibleFailure,
    // 삭제된 메시지도 기존처럼 스레드를 열 수 있다.
    canOpenThread: isSent,
    canReact,
    canEdit: canModify,
    canDelete: canModify,
  };
}
