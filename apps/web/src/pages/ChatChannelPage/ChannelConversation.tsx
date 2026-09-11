import { useCallback, useRef, useState } from "react";
import { useChatSession, useStartChatSession } from "../../features/chat/useChatChannel";
import { ChannelConversationView } from "./ChannelConversationView";
import { ChannelHeaderView } from "./ChannelHeaderView";
import { ChannelMessageList } from "./messages/ChannelMessageList";
import { MessageComposerView } from "./composer/MessageComposerView";
import ConnectedThreadPanel from "./thread/ConnectedThreadPanel";
import { ChannelThreadPanelView } from "./thread/ChannelThreadPanelView";
import type { ChannelMember } from "./channelMember";
import { ConnectedVoiceCall } from "./voice/ConnectedVoiceCall";
import styles from "./ChatChannelPage.module.css";

// 멤버 API가 없어 기존 임시 제공 방식을 유지한다.
const CHANNEL_MEMBERS: readonly ChannelMember[] = [
  { id: "user-me", name: "나", isOnline: true },
  { id: "user-alice", name: "Alice", isOnline: true },
  { id: "user-bob", name: "Bob", isOnline: false },
  { id: "user-carol", name: "Carol", isOnline: true },
  { id: "user-dan", name: "Dan", isOnline: false },
];

export function ChannelConversation({
  channelId,
  onOpenChannelList,
}: {
  channelId: string;
  onOpenChannelList: () => void;
}) {
  const session = useChatSession({ type: "channel", channelId });
  useStartChatSession(session);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | undefined>(undefined);
  const [threadOpenRequestId, setThreadOpenRequestId] = useState(0);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [isPanelOverlayOpen, setIsPanelOverlayOpen] = useState(false);

  const handleOpenThread = useCallback(
    (key: string) => {
      setSelectedThreadKey((previous) =>
        previous !== undefined && session.message(previous).value?.key === key ? previous : key,
      );
      setThreadOpenRequestId((id) => id + 1);
      setIsPanelCollapsed(false);
      setIsPanelOverlayOpen(true);
    },
    [session],
  );
  const handleOpenPanel = () => {
    setIsPanelCollapsed(false);
    setIsPanelOverlayOpen(true);
  };
  const closeThreadPanel = () => {
    setIsPanelOverlayOpen(false);
    setSelectedThreadKey(undefined);
  };

  return (
    <ConnectedVoiceCall roomId={channelId} anchorRef={scrollRef}>
      {({ joinButton, callBar }) => (
        <ChannelConversationView
          isPanelCollapsed={isPanelCollapsed}
          header={
            <ChannelHeaderView
              channelName={channelId}
              onOpenChannelList={onOpenChannelList}
              onOpenPanel={handleOpenPanel}
              voiceJoinButton={joinButton}
            />
          }
          floating={callBar}
          messageArea={
            <ChannelMessageList
              session={session}
              scrollRef={scrollRef}
              selectedThreadKey={selectedThreadKey}
              onOpenThread={handleOpenThread}
              unreadCount={Math.max(CHANNEL_MEMBERS.length - 1, 0)}
            />
          }
          composer={
            <MessageComposerView
              placeholder={`#${channelId}에 메시지 보내기`}
              members={CHANNEL_MEMBERS}
              onSend={session.sendMessage}
            />
          }
          panel={
            <ChannelThreadPanelView
              isOverlayOpen={isPanelOverlayOpen}
              onClose={closeThreadPanel}
              panel={
                <ConnectedThreadPanel
                  session={session}
                  selectedKey={selectedThreadKey}
                  className={
                    isPanelOverlayOpen ? `${styles.panel} ${styles.panelOpen}` : styles.panel
                  }
                  onClose={closeThreadPanel}
                  openRequestId={threadOpenRequestId}
                  members={CHANNEL_MEMBERS}
                  isCollapsed={isPanelCollapsed}
                  onCollapsedChange={setIsPanelCollapsed}
                />
              }
            />
          }
        />
      )}
    </ConnectedVoiceCall>
  );
}
