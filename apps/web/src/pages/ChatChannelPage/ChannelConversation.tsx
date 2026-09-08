import { useRef, useState } from "react";

import { useChatChannel } from "../../features/chat/useChatChannel";
import { ChannelConversationView } from "./ChannelConversationView";
import { ChannelHeaderView } from "./ChannelHeaderView";
import { ChannelMessageList } from "./messages/ChannelMessageList";
import { ChannelMessageComposer } from "./composer/ChannelMessageComposer";
import ConnectedThreadPanel from "./thread/ConnectedThreadPanel";
import { ChannelThreadPanelView } from "./thread/ChannelThreadPanelView";
import type { ChannelMember } from "./thread/ThreadPanelView";
import { ConnectedVoiceCall } from "./voice/ConnectedVoiceCall";
import styles from "./ChatChannelPage.module.css";

// 방 멤버 목록/인원수 API가 아직 없어(chat-backend-contract 참고) 고정값으로 mock한다.
// 모듈을 평가할 때 생성되는 공유 배열이다. 특정 컴포넌트의 생성·제거와 수명이 연결되지 않는다.
const CHANNEL_MEMBERS: ChannelMember[] = [
  { id: "user-me", name: "나", isOnline: true },
  { id: "user-alice", name: "Alice", isOnline: true },
  { id: "user-bob", name: "Bob", isOnline: false },
  { id: "user-carol", name: "Carol", isOnline: true },
  { id: "user-dan", name: "Dan", isOnline: false },
];

// 페이지 함수 밖에서 선언해야 페이지가 다시 렌더링되어도 같은 컴포넌트로 유지된다.
// 채널의 헤더·통화·메시지·입력·스레드를 묶고, 선택한 메시지는 이 경계 안에서만 연결한다.
export function ChannelConversation({
  channelId,
  onOpenChannelList,
}: {
  channelId: string;
  onOpenChannelList: () => void;
}) {
  // 함수 호출마다 지역 변수는 다시 선언된다. 아래 훅은 호출 사이에 필요한 기억을 리액트에 맡긴다.
  // useState: 같은 컴포넌트가 트리에 유지되는 동안 상태를 보관하며, setter로 값을 바꾸면 다시 렌더링한다.
  // useRef: 같은 기간에 동일한 { current: ... } 객체를 돌려준다. current 변경만으로는 다시 렌더링하지 않는다.
  // 컴포넌트가 트리에서 제거되면 이 기억은 끝난다. CSS로 숨기거나 channelId만 바꾸는 것은 제거가 아니다.
  // 아래 상태와 참조에는 channelId 변경에 따른 초기화 처리가 없어, 같은 컴포넌트라면 채널을 바꿔도 유지된다.
  // 채팅 세션의 외부 상태를 구독한다. 세션 변경 시 다시 렌더링하며, channelId가 바뀌면 구독 대상도 바뀐다.
  // 아래 값은 이번 렌더링에 읽은 결과다. 구독 해제와 채팅 세션 자체의 종료는 별개의 생명주기다.
  const {
    // 이번 렌더링마다 세션 메시지를 화면용 객체의 새 배열로 변환한 결과.
    messages,
    // 현재 세션의 최초 메시지 조회가 진행 중인지 나타내는 값.
    isLoading,
    // 현재 세션의 이전 메시지 조회가 진행 중인지 나타내는 값.
    isLoadingOlder,
    // 현재 세션의 이전 메시지 조회가 실패했는지 나타내는 값.
    olderFailed,
    // 현재 세션에 더 조회할 이전 메시지가 있는지 나타내는 값.
    hasMoreBefore,
    // 현재 세션의 메시지 복구 진행 또는 실패 단계를 나타내는 값.
    recoveryPhase,
    // 아래 항목은 상태가 아니라 세션을 조작하는 함수이며, 훅이 매 렌더링마다 새로 만든다.
    deleteMessage,
    discardMessage,
    editMessage,
    loadOlder,
    retryRecovery,
    sendMessage,
    retryMessage,
  } = useChatChannel(channelId);
  // 참조: 메시지 목록의 실제 화면 요소. 리액트가 요소 연결 시 current에 넣고 제거 시 null로 바꾼다.
  const scrollRef = useRef<HTMLDivElement>(null);
  // 상태: 선택한 스레드의 부모 메시지 키. undefined로 시작하며, 스레드를 열 때 설정하고 닫을 때 지운다.
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | undefined>(undefined);
  // 같은 메시지를 다시 열 때도 패널 기능에 새 열기 요청을 전달한다.
  const [threadOpenRequestId, setThreadOpenRequestId] = useState(0);
  // 상태: 패널 접힘 여부. 처음에는 펼쳐져 있으며, 패널이나 스레드를 열면 접힘을 해제한다.
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  // 상태: 모바일 패널의 열림 여부. false로 시작하며, 패널 열기·닫기·배경 클릭으로 갱신한다.
  const [isPanelOverlayOpen, setIsPanelOverlayOpen] = useState(false);
  // 계산값: 매 렌더링마다 현재 목록에서 선택한 부모 메시지를 찾는다. 별도로 보관한 메시지가 아니다.
  const selectedThreadParent = messages.find((message) => message.key === selectedThreadKey);

  const handleOpenThread = (messageKey: string) => {
    setSelectedThreadKey(messageKey);
    setThreadOpenRequestId((id) => id + 1);
    setIsPanelCollapsed(false);
    setIsPanelOverlayOpen(true);
  };

  const handleOpenPanel = () => {
    setIsPanelCollapsed(false);
    setIsPanelOverlayOpen(true);
  };

  const closeThreadPanel = () => {
    setIsPanelOverlayOpen(false);
    setSelectedThreadKey(undefined);
  };

  // 기능의 연결부를 배치한다. 통화 모델은 채팅 채널과 같은 방 식별자로 한 번만 생성한다.
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
              messages={messages}
              isLoading={isLoading}
              isLoadingOlder={isLoadingOlder}
              olderFailed={olderFailed}
              hasMoreBefore={hasMoreBefore}
              recoveryPhase={recoveryPhase}
              scrollRef={scrollRef}
              loadOlder={loadOlder}
              retryRecovery={retryRecovery}
              retryMessage={retryMessage}
              discardMessage={discardMessage}
              selectedThreadKey={selectedThreadKey}
              onOpenThread={handleOpenThread}
              unreadCount={Math.max(CHANNEL_MEMBERS.length - 1, 0)}
            />
          }
          composer={
            <ChannelMessageComposer
              placeholder={`#${channelId}에 메시지 보내기`}
              members={CHANNEL_MEMBERS}
              onSend={sendMessage}
            />
          }
          panel={
            <ChannelThreadPanelView
              isOverlayOpen={isPanelOverlayOpen}
              onClose={closeThreadPanel}
              panel={
                <ConnectedThreadPanel
                  className={
                    isPanelOverlayOpen ? `${styles.panel} ${styles.panelOpen}` : styles.panel
                  }
                  onClose={closeThreadPanel}
                  openRequestId={threadOpenRequestId}
                  parentMessage={selectedThreadParent}
                  onEditMessage={editMessage}
                  onDeleteMessage={deleteMessage}
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
