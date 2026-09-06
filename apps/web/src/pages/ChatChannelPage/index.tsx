import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { useChatChannel } from "../../features/chat/useChatChannel";
import { useVoiceCall } from "../../features/voice/useVoiceCall";
import useVisualViewportHeight from "../../hooks/useVisualViewportHeight";
import type { MessageReactionsValue } from "./MessageReactions";
import ChannelListContent from "./ChannelListSidebar";
import { ChannelConversationView, PanelBackdrop } from "./ChannelConversationView";
import { MessageListView } from "./MessageListView";
import type { ChannelMember, ThreadPanelTab } from "./ThreadPanel";
import { createChatComposerSubmitController } from "./chatComposerKeyPolicy";
import styles from "./ChatChannelPage.module.css";

/** 커서 바로 앞에서 진행 중인 "@닉네임" 멘션 입력을 찾는다. 공백/줄바꿈이 나오면 멘션 입력이 끝난 것으로 본다. */
function findMentionQuery(value: string, cursor: number): string | undefined {
  const beforeCursor = value.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
  return match?.[1];
}

// 방 멤버 목록/인원수 API가 아직 없어(chat-backend-contract 참고) 고정값으로 mock한다.
// 모듈을 평가할 때 생성되는 공유 배열이다. 특정 컴포넌트의 생성·제거와 수명이 연결되지 않는다.
const CHANNEL_MEMBERS: ChannelMember[] = [
  { id: "user-me", name: "나", isOnline: true },
  { id: "user-alice", name: "Alice", isOnline: true },
  { id: "user-bob", name: "Bob", isOnline: false },
  { id: "user-carol", name: "Carol", isOnline: true },
  { id: "user-dan", name: "Dan", isOnline: false },
];

function ChatChannelPage() {
  // 주소에서 채널을 읽고, 해당 채널의 대화 영역과 채널 목록을 배치한다.
  const { channelId = "test" } = useParams();
  useVisualViewportHeight();
  // 상태: 페이지에 속한 모바일 채널 목록의 열림 여부. 같은 페이지가 유지되는 동안 기억한다.
  // 대화 영역은 열기를 요청하고, 채널 목록은 닫기를 요청한다. 상태 변경은 이 페이지가 담당한다.
  const [isChannelListOpen, setIsChannelListOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <ChannelListSidebar
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

// 채널 목록의 표시와 배경을 함께 담당한다. isOpen은 좁은 화면에서의 열림 요청이다.
// 화면 폭 기준은 기존 CSS 한 곳에 둔다. 추후 공통 화면 정보가 필요하면 이 컴포넌트에서 읽는다.
function ChannelListSidebar({
  channelId,
  isOpen,
  onClose,
}: {
  channelId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {isOpen ? <PanelBackdrop onClose={onClose} closeLabel="채널 목록 닫기" /> : null}
      {/* 목록은 계속 유지하고 CSS로 표시한다. 넓은 화면에서는 isOpen과 관계없이 보인다. */}
      <ChannelListContent
        channelId={channelId}
        className={isOpen ? `${styles.drawer} ${styles.drawerOpen}` : styles.drawer}
      />
    </>
  );
}

// 페이지 함수 밖에서 선언해야 페이지가 다시 렌더링되어도 같은 컴포넌트로 유지된다.
// 채널의 헤더·통화·메시지·입력·스레드를 묶고, 선택한 메시지는 이 경계 안에서만 연결한다.
function ChannelConversation({
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
  // 통화 방은 채팅 채널과 같은 식별자를 쓴다. 채널에 있으면 그 방의 통화에 들어갈 수 있다.
  // 훅 내부 통화 모델의 상태를 구독한 결과와 조작 함수다. 반환 객체는 매 렌더링마다 새로 만들어진다.
  // 채널 변경이나 컴포넌트 제거 시 훅의 정리 함수가 이전 모델의 통화를 종료한다.
  const voice = useVoiceCall(channelId);
  // 상태: 작성 중인 입력 내용. 처음에는 빈 문자열이며, 입력 시 갱신하고 전송 후 비운다.
  const [draft, setDraft] = useState("");
  // 참조: 메시지 목록의 실제 화면 요소. 리액트가 요소 연결 시 current에 넣고 제거 시 null로 바꾼다.
  const scrollRef = useRef<HTMLDivElement>(null);
  // 참조: 스크롤이 하단 근처인지 기억한다. 처음에는 true이며, 스크롤 이벤트에서 갱신한다.
  const isAtBottomRef = useRef(true);
  // 참조: 실제 입력창 요소. 리액트가 연결/해제하며, 높이 측정·초점·커서 위치 조작에 사용한다.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 참조: 한글 조합 중인지와 Enter 전송 대기 여부를 기억하는 제어 객체를 유지한다.
  // 주의: 인자의 생성 함수는 매 렌더링마다 실행되지만, 초기화 이후 만든 객체는 useRef가 저장하지 않는다.
  const submitControllerRef = useRef(createChatComposerSubmitController());
  // 상태: 입력창이 여러 줄 높이인지 기억한다. 처음에는 false이며, draft 변경 후 높이를 측정해 갱신한다.
  const [isDraftMultiline, setIsDraftMultiline] = useState(false);
  // 참조: 최초 측정한 한 줄 높이. 처음에는 undefined이며, 한 번 기록한 높이를 이후 비교에 사용한다.
  const singleLineHeightRef = useRef<number | undefined>(undefined);

  // "@"로 멘션할 멤버를 고르는 팝업. 백엔드에 멘션 개념이 없어 텍스트에 이름을 끼워 넣는 UI만 구현한다.
  // 상태: 커서 앞의 멘션 검색어. undefined로 시작하며, 멘션 선택·전송·멘션 Escape 처리 시 지운다.
  const [mentionQuery, setMentionQuery] = useState<string | undefined>(undefined);
  // 상태: 키보드로 선택 중인 멘션 후보의 위치. 0으로 시작하며, 입력 변경 시 0으로 되돌린다.
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  // 계산값: 현재 검색어로 매 렌더링마다 새 배열을 만든다. 리액트에 따로 보관하는 상태가 아니다.
  const mentionMatches =
    mentionQuery === undefined
      ? []
      : CHANNEL_MEMBERS.filter((member) =>
          member.name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
        );
  // 계산값: 검색어와 후보 목록으로 매 렌더링마다 팝업 표시 여부를 구한다.
  const isMentionOpen = mentionQuery !== undefined && mentionMatches.length > 0;

  // 상태: 선택한 스레드의 부모 메시지 키. undefined로 시작하며, 스레드를 열 때 설정하고 닫을 때 지운다.
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | undefined>(undefined);
  // 상태: 패널에서 선택한 탭. 처음에는 thread이며, 스레드를 열 때도 thread로 바꾼다.
  const [panelTab, setPanelTab] = useState<ThreadPanelTab>("thread");
  // 상태: 패널 접힘 여부. 처음에는 펼쳐져 있으며, 패널이나 스레드를 열면 접힘을 해제한다.
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  // 상태: 모바일 패널의 열림 여부. false로 시작하며, 패널 열기·닫기·배경 클릭으로 갱신한다.
  const [isPanelOverlayOpen, setIsPanelOverlayOpen] = useState(false);
  // 상태: 메시지별 리액션 수와 내 반응 여부. 빈 객체로 시작하며, 클릭으로만 갱신하는 대화 영역 내부 상태다.
  // 서버에 저장하지 않으며, 컴포넌트가 제거되면 사라진다. 채널 변경만으로는 비워지지 않는다.
  const [reactionsByMessageKey, setReactionsByMessageKey] = useState<
    Record<string, MessageReactionsValue>
  >({});

  // 계산값: 매 렌더링마다 현재 목록에서 선택한 부모 메시지를 찾는다. 별도로 보관한 메시지가 아니다.
  const selectedThreadParent = messages.find((message) => message.key === selectedThreadKey);

  const handleOpenThread = (messageKey: string) => {
    setSelectedThreadKey(messageKey);
    setPanelTab("thread");
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

  const handleToggleReaction = (messageKey: string, emoji: string) => {
    setReactionsByMessageKey((prev) => {
      const current = prev[messageKey] ?? {};
      const wasReacted = current[emoji]?.reactedByMe ?? false;
      const nextCount = (current[emoji]?.count ?? 0) + (wasReacted ? -1 : 1);

      const nextMessageReactions = { ...current };
      if (nextCount <= 0) {
        delete nextMessageReactions[emoji];
      } else {
        nextMessageReactions[emoji] = { count: nextCount, reactedByMe: !wasReacted };
      }

      return { ...prev, [messageKey]: nextMessageReactions };
    });
  };

  // 입력 내용에 따라 textarea 높이를 늘린다(최대 높이는 CSS max-height 가 제한).
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    // 첫 측정은 빈 입력이라 한 줄 높이다.
    singleLineHeightRef.current ??= el.scrollHeight;
    el.style.height = `${el.scrollHeight}px`;
    setIsDraftMultiline(el.scrollHeight > singleLineHeightRef.current);
  }, [draft]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el === null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 100;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const isMineLatest = messages.at(-1)?.isMine ?? false;
    if (!isAtBottomRef.current && !isMineLatest) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = (text: string) => {
    submitControllerRef.current.cancelPendingSubmit();
    if (text.trim() === "") return;
    sendMessage(text);
    setDraft("");
    setMentionQuery(undefined);
  };

  const handleDraftChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft(value);
    setMentionQuery(findMentionQuery(value, event.target.selectionStart));
    setMentionActiveIndex(0);
  };

  const handleSelectMention = (member: ChannelMember) => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor).replace(/@([^\s@]*)$/, `@${member.name} `);
    const after = draft.slice(cursor);
    setDraft(before + after);
    setMentionQuery(undefined);

    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const submitController = submitControllerRef.current;

    if (isMentionOpen) {
      if (submitController.isImeProcessing(event.nativeEvent)) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index + 1) % mentionMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionActiveIndex(
          (index) => (index - 1 + mentionMatches.length) % mentionMatches.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const activeMember = mentionMatches[mentionActiveIndex];
        if (activeMember !== undefined) handleSelectMention(activeMember);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionQuery(undefined);
        return;
      }
    }

    const result = submitController.handleKeyDown(event.nativeEvent);
    if (result.shouldPreventDefault) event.preventDefault();
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!submitControllerRef.current.consumeSubmitOnKeyUp(event.nativeEvent)) return;
    handleSend(event.currentTarget.value);
  };

  // 이번 단계에서는 기존 로직을 유지하고, 화면이 필요로 하는 값과 동작을 명시한다.
  // 아래 경계가 입력·목록·패널 로직을 각각 분리할 때의 출발점이다.
  return (
    <ChannelConversationView
      channelId={channelId}
      onOpenChannelList={onOpenChannelList}
      onOpenPanel={handleOpenPanel}
      voice={{ ...voice, anchorRef: scrollRef }}
      messageArea={
        <MessageListView
          isLoading={isLoading}
          isLoadingOlder={isLoadingOlder}
          olderFailed={olderFailed}
          hasMoreBefore={hasMoreBefore}
          recoveryPhase={recoveryPhase}
          scrollRef={scrollRef}
          onScroll={handleScroll}
          loadOlder={loadOlder}
          retryRecovery={retryRecovery}
          items={messages.map((message) => ({
            message,
            onRetry: message.status === "failed" ? () => retryMessage(message) : undefined,
            onDelete: message.status === "failed" ? () => discardMessage(message) : undefined,
            isThreadActive: message.key === selectedThreadKey,
            onOpenThread: () => handleOpenThread(message.key),
            reactions: reactionsByMessageKey[message.key] ?? {},
            onToggleReaction: (emoji) => handleToggleReaction(message.key, emoji),
            unreadCount: Math.max(CHANNEL_MEMBERS.length - 1, 0),
          }))}
        />
      }
      composer={{
        draft,
        isDraftMultiline,
        canSend: draft.trim() !== "",
        textareaRef,
        mentionPicker: isMentionOpen
          ? {
              members: mentionMatches,
              activeIndex: mentionActiveIndex,
              onSelect: handleSelectMention,
            }
          : undefined,
        onChange: handleDraftChange,
        onKeyDown: handleKeyDown,
        onKeyUp: handleKeyUp,
        onCompositionStart: () => submitControllerRef.current.compositionStarted(),
        onCompositionEnd: () => submitControllerRef.current.compositionEnded(),
        onBlur: () => submitControllerRef.current.cancelPendingSubmit(),
        onSend: () => handleSend(draft),
      }}
      isPanelOverlayOpen={isPanelOverlayOpen}
      thread={{
        onClose: closeThreadPanel,
        activeTab: panelTab,
        onTabChange: setPanelTab,
        parentMessage: selectedThreadParent,
        onEditParent: (text) => {
          if (selectedThreadParent !== undefined) editMessage(selectedThreadParent, text);
        },
        onDeleteParent: () => {
          if (selectedThreadParent !== undefined) deleteMessage(selectedThreadParent);
        },
        members: CHANNEL_MEMBERS,
        isCollapsed: isPanelCollapsed,
        onCollapsedChange: setIsPanelCollapsed,
      }}
    />
  );
}

export { ChatChannelPage as Component };
