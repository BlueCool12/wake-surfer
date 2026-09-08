import { useState } from "react";
import { useParams } from "react-router-dom";

import useVisualViewportHeight from "../../hooks/useVisualViewportHeight";
import { ChannelConversation } from "./ChannelConversation";
import { ChannelListSidebarView } from "./channel-list/ChannelListSidebarView";
import styles from "./ChatChannelPage.module.css";

function ChatChannelPage() {
  // 주소에서 채널을 읽고, 해당 채널의 대화 영역과 채널 목록을 배치한다.
  const { channelId = "test" } = useParams();
  useVisualViewportHeight();
  // 상태: 페이지에 속한 모바일 채널 목록의 열림 여부. 같은 페이지가 유지되는 동안 기억한다.
  // 대화 영역은 열기를 요청하고, 채널 목록은 닫기를 요청한다. 상태 변경은 이 페이지가 담당한다.
  const [isChannelListOpen, setIsChannelListOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <ChannelListSidebarView
        channelId={channelId}
        isOpen={isChannelListOpen}
        onClose={() => setIsChannelListOpen(false)}
      />
      <ChannelConversation
        channelId={channelId}
        onOpenChannelList={() => setIsChannelListOpen(true)}
      />
    </div>
  );
}

export { ChatChannelPage as Component };
