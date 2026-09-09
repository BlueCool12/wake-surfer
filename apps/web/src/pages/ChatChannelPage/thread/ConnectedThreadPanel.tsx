import { memo, useState } from "react";
import type { RealtimeChatTargetSession } from "@wake-surfer/realtime-chat-stream-messages-client";
import {
  toChatMessageView,
  useChatMessage,
  useChatScope,
  useChatSession,
  useStartChatSession,
} from "../../../features/chat/useChatChannel";
import { ChannelMessageRow } from "../messages/ChannelMessageRow";
import { ChatHistoryStatus, ChatOlderHistory } from "../messages/ChatHistoryStatus";
import ThreadPanelView, { type ThreadPanelTab, type ThreadPanelViewProps } from "./ThreadPanelView";
import { ThreadConversationView } from "./ThreadConversationView";
import styles from "./ThreadPanelView.module.css";

type Props = Omit<ThreadPanelViewProps, "activeTab" | "onTabChange" | "thread"> & {
  session: RealtimeChatTargetSession;
  selectedKey: string | undefined;
  openRequestId: number;
};

export default function ConnectedThreadPanel({
  session,
  selectedKey,
  openRequestId,
  ...props
}: Props) {
  const [selection, setSelection] = useState<{ requestId: number; tab: ThreadPanelTab }>({
    requestId: openRequestId,
    tab: "thread",
  });
  const activeTab = selection.requestId === openRequestId ? selection.tab : "thread";
  const visible = !props.isCollapsed && activeTab === "thread";
  return (
    <ThreadPanelView
      {...props}
      activeTab={activeTab}
      onTabChange={(tab) => setSelection({ requestId: openRequestId, tab })}
      thread={
        <SelectedThread
          key={selectedKey ?? "unselected"}
          session={session}
          selectedKey={selectedKey}
          visible={visible}
        />
      }
    />
  );
}

function SelectedThread({
  session,
  selectedKey,
  visible,
}: {
  session: RealtimeChatTargetSession;
  selectedKey: string | undefined;
  visible: boolean;
}) {
  const parent = useChatMessage(session, selectedKey);
  if (parent === undefined || parent.messageId === undefined) {
    return visible ? (
      <div className={styles.emptyState}>
        <p>
          {selectedKey === undefined
            ? "채팅 메시지를 눌러 스레드를 시작해보세요."
            : "선택한 메시지를 표시할 수 없습니다."}
        </p>
      </div>
    ) : null;
  }
  return (
    <ConnectedThreadConversation
      key={parent.messageId}
      threadId={parent.messageId}
      parentMessage={toChatMessageView(parent)}
      visible={visible}
      onEditParent={parent.canEdit() ? (text) => parent.edit(text) : undefined}
      onDeleteParent={parent.canDelete() ? () => parent.delete() : undefined}
    />
  );
}

function ConnectedThreadConversation({
  threadId,
  ...props
}: Omit<Parameters<typeof ThreadConversationView>[0], "replies" | "onAddReply"> & {
  threadId: string;
}) {
  const session = useChatSession({ type: "thread", threadId });
  useStartChatSession(session);
  return (
    <ThreadConversationView
      {...props}
      onAddReply={session.sendMessage}
      replies={<ThreadReplies session={session} />}
    />
  );
}

const ThreadReplies = memo(function ThreadReplies({
  session,
}: {
  session: RealtimeChatTargetSession;
}) {
  const keys = useChatScope(session.messageKeys);
  return (
    <div className={styles.replyList}>
      <ChatOlderHistory session={session} />
      <ChatHistoryStatus
        session={session}
        empty={keys.length === 0}
        emptyText="아직 답글이 없어요."
      />
      {keys.map((key) => (
        <ChannelMessageRow key={key} session={session} messageKey={key} />
      ))}
    </div>
  );
});
