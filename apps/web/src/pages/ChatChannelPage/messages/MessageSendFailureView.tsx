import useIsCoarsePointer from "../../../hooks/useIsCoarsePointer";
import { MessageSendFailureInlineView } from "./MessageSendFailureInlineView";
import { MessageSendFailureSheetView } from "./MessageSendFailureSheetView";
import type { MessageSendFailureViewProps } from "./MessageSendFailureView.types";

/** 입력 장치와 가능한 동작에 따라 전송 실패 화면을 선택한다. */
export function MessageSendFailureView(props: MessageSendFailureViewProps) {
  const isCoarsePointer = useIsCoarsePointer();
  const hasActions = props.onRetry !== undefined || props.onDiscard !== undefined;

  if (isCoarsePointer && hasActions) {
    return <MessageSendFailureSheetView {...props} />;
  }

  return <MessageSendFailureInlineView {...props} />;
}
