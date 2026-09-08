import { useState } from "react";
import type { ComponentProps } from "react";

import { useChatThread } from "../../../features/chat/useChatChannel";
import type { UseChatChannelResult } from "../../../features/chat/useChatChannel";
import { getMessageActionAvailability } from "../messageActionPolicy";
import ThreadPanelView, { type ThreadPanelTab, type ThreadReply } from "./ThreadPanelView";

type ConnectedThreadPanelProps = Omit<
  ComponentProps<typeof ThreadPanelView>,
  | "isParentDeleted"
  | "isParentEdited"
  | "replies"
  | "onAddReply"
  | "onEditParent"
  | "onDeleteParent"
  | "activeTab"
  | "onTabChange"
> & {
  onEditMessage: UseChatChannelResult["editMessage"];
  onDeleteMessage: UseChatChannelResult["deleteMessage"];
  // 같은 메시지를 다시 열어도 스레드 탭으로 돌아가도록, 선택 키와 열기 요청을 구분한다.
  openRequestId: number;
};

type ThreadConversationProps = Omit<
  ComponentProps<typeof ThreadPanelView>,
  "replies" | "onAddReply"
>;
const EMPTY_REPLIES: ThreadReply[] = [];

// 패널 탭과 부모 메시지의 동작을 연결한다. 답글 조회는 선택된 스레드 안에서 구독한다.
function ConnectedThreadPanel({
  onEditMessage,
  onDeleteMessage,
  openRequestId,
  ...props
}: ConnectedThreadPanelProps) {
  const [tabSelection, setTabSelection] = useState<{ requestId: number; tab: ThreadPanelTab }>({
    requestId: openRequestId,
    tab: "thread",
  });
  const activeTab = tabSelection.requestId === openRequestId ? tabSelection.tab : "thread";
  const { parentMessage } = props;
  const available = getMessageActionAvailability(parentMessage);
  const panelProps: ThreadConversationProps = {
    ...props,
    activeTab,
    onTabChange: (tab) => setTabSelection({ requestId: openRequestId, tab }),
    isParentDeleted: parentMessage?.isDeleted ?? false,
    isParentEdited: parentMessage?.isEdited ?? false,
    onEditParent:
      available.canEdit && parentMessage !== undefined
        ? (text) => onEditMessage(parentMessage, text)
        : undefined,
    onDeleteParent:
      available.canDelete && parentMessage !== undefined
        ? () => onDeleteMessage(parentMessage)
        : undefined,
  };
  const threadId = parentMessage?.messageId;

  if (threadId === undefined) {
    return <ThreadPanelView {...panelProps} replies={EMPTY_REPLIES} onAddReply={() => undefined} />;
  }

  return <ConnectedThreadConversation {...panelProps} threadId={threadId} />;
}

function ConnectedThreadConversation({
  threadId,
  ...props
}: ThreadConversationProps & { threadId: string }) {
  const { messages, sendMessage } = useChatThread(threadId);
  const replies: ThreadReply[] = messages.map((message) => ({
    id: message.key,
    text: message.isDeleted ? "삭제된 메시지입니다" : message.text,
    createdAt: message.createdAt,
  }));

  return <ThreadPanelView {...props} replies={replies} onAddReply={sendMessage} />;
}

export default ConnectedThreadPanel;
