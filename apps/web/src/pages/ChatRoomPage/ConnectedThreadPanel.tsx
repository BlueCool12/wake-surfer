import type { ComponentProps } from "react";

import { useChatThread } from "../../features/chat/useChatRoom";
import ThreadPanel, { type ThreadReply } from "./ThreadPanel";

type ConnectedThreadPanelProps = Omit<
  ComponentProps<typeof ThreadPanel>,
  "isParentDeleted" | "isParentEdited" | "replies" | "onAddReply"
>;

const EMPTY_REPLIES: ThreadReply[] = [];

function ConnectedThreadPanel(props: ConnectedThreadPanelProps) {
  const { parentMessage } = props;
  const threadId = parentMessage?.messageId;

  if (threadId === undefined) {
    return (
      <ThreadPanel
        {...props}
        isParentDeleted={parentMessage?.isDeleted ?? false}
        isParentEdited={parentMessage?.isEdited ?? false}
        replies={EMPTY_REPLIES}
        onAddReply={() => undefined}
      />
    );
  }

  return <ConnectedThreadConversation {...props} threadId={threadId} />;
}

function ConnectedThreadConversation({
  threadId,
  ...props
}: ConnectedThreadPanelProps & { threadId: string }) {
  const { messages, sendMessage } = useChatThread(threadId);
  const replies: ThreadReply[] = messages.map((message) => ({
    id: message.key,
    text: message.isDeleted ? "삭제된 메시지입니다" : message.text,
    createdAt: message.createdAt,
  }));

  return (
    <ThreadPanel
      {...props}
      isParentDeleted={props.parentMessage?.isDeleted ?? false}
      isParentEdited={props.parentMessage?.isEdited ?? false}
      replies={replies}
      onAddReply={sendMessage}
    />
  );
}

export default ConnectedThreadPanel;
