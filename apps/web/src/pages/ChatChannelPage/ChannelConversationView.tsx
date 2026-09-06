import type { ComponentProps, RefObject } from "react";
import { Headset, Menu, PanelRight, Send } from "lucide-react";

import Loading from "../../components/Loading";
import ThemeToggle from "../../components/ThemeToggle";
import ThreadPanel from "./ConnectedThreadPanel";
import MentionPicker from "./MentionPicker";
import { VoiceCallBar } from "./VoiceCallBar";
import MessageBubble from "./MessageBubble";
import styles from "./ChatChannelPage.module.css";

// 패널 바깥을 덮는 배경이다. 필요한 영역이 조건부로 표시하고, 클릭하면 닫기를 요청한다.
export function PanelBackdrop({
  onClose,
  closeLabel,
}: {
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <button
      type="button"
      className={styles.scrim}
      onClick={onClose}
      aria-label={closeLabel}
      tabIndex={-1}
    />
  );
}

// 뷰가 받아야 하는 값과 이벤트를 목록·입력·통화·스레드별로 드러낸다.
type ChannelConversationViewProps = {
  channelId: string;
  onOpenChannelList: () => void;
  onOpenPanel: () => void;
  voice: ComponentProps<typeof VoiceCallBar> & { join: () => void };
  messageList: {
    isLoading: boolean;
    isLoadingOlder: boolean;
    olderFailed: boolean;
    hasMoreBefore: boolean;
    recoveryPhase: string;
    scrollRef: RefObject<HTMLDivElement | null>;
    onScroll: () => void;
    loadOlder: () => void;
    retryRecovery: () => void;
    items: ComponentProps<typeof MessageBubble>[];
  };
  composer: {
    draft: string;
    isDraftMultiline: boolean;
    canSend: boolean;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    mentionPicker: ComponentProps<typeof MentionPicker> | undefined;
    onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
    onKeyUp: React.KeyboardEventHandler<HTMLTextAreaElement>;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
    onBlur: () => void;
    onSend: () => void;
  };
  isPanelOverlayOpen: boolean;
  thread: ComponentProps<typeof ThreadPanel>;
};

// 표시 조건과 배치만 담당한다. 상태·구독·요소 측정·전송 판단은 ChannelConversation에 있다.
// ref는 실제 요소에 연결만 하고, current를 읽거나 변경하지 않는다.
export function ChannelConversationView({
  channelId,
  onOpenChannelList,
  onOpenPanel,
  voice,
  messageList,
  composer,
  isPanelOverlayOpen,
  thread,
}: ChannelConversationViewProps) {
  const {
    isLoading,
    isLoadingOlder,
    olderFailed,
    hasMoreBefore,
    recoveryPhase,
    loadOlder,
    retryRecovery,
  } = messageList;

  return (
    <div
      className={
        thread.isCollapsed ? `${styles.mainArea} ${styles.mainAreaPanelCollapsed}` : styles.mainArea
      }
    >
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onOpenChannelList}
          aria-label="채널 목록 열기"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
        <span className={styles.channelHash}>#</span>
        <h1 className={styles.channelName}>{channelId}</h1>
        {/* 참가 전용이다. 음소거·나가기는 통화 중에만 나타나는 아래 바가 전담한다. */}
        <button
          type="button"
          className={styles.callButton}
          onClick={voice.join}
          disabled={voice.status === "joining" || voice.status === "connected"}
          aria-pressed={voice.status === "connected"}
          aria-label={voice.status === "connected" ? "음성 통화 참가 중" : "음성 통화 참가"}
        >
          <Headset size={16} aria-hidden="true" />
        </button>
        <ThemeToggle className={styles.themeToggle} />
        <button
          type="button"
          className={styles.iconButton}
          onClick={onOpenPanel}
          aria-label="스레드 패널 열기"
        >
          <PanelRight size={18} aria-hidden="true" />
        </button>
      </header>

      {/* 화면 위를 떠다니므로 레이아웃상 위치는 의미가 없다. 헤더 다음에 두어 읽기 쉽게만 한다. */}
      <VoiceCallBar
        status={voice.status}
        participants={voice.participants}
        isMuted={voice.isMuted}
        error={voice.error}
        leave={voice.leave}
        toggleMute={voice.toggleMute}
        anchorRef={voice.anchorRef}
      />

      <div className={styles.page}>
        <div
          className={styles.messages}
          ref={messageList.scrollRef}
          onScroll={messageList.onScroll}
        >
          {isLoading ? (
            <Loading />
          ) : (
            <>
              {hasMoreBefore ? (
                <button type="button" className={styles.loadOlder} onClick={loadOlder}>
                  {isLoadingOlder
                    ? "이전 메시지 불러오는 중…"
                    : olderFailed
                      ? "이전 메시지 다시 불러오기"
                      : "이전 메시지 불러오기"}
                </button>
              ) : null}
              {recoveryPhase === "recovery_pending" ? (
                <p className={styles.recoveryNotice}>누락된 메시지를 이어서 복구하고 있어요.</p>
              ) : recoveryPhase === "retryable_failure" ? (
                <button type="button" className={styles.recoveryNotice} onClick={retryRecovery}>
                  연결이 잠시 끊겼어요. 복구 시도하기
                </button>
              ) : recoveryPhase === "stream_unavailable" ||
                recoveryPhase === "invalid_cursor" ||
                recoveryPhase === "authentication_failure" ||
                recoveryPhase === "protocol_failure" ? (
                <p className={styles.recoveryError}>메시지 기록을 안전하게 불러오지 못했어요.</p>
              ) : null}
              {messageList.items.length === 0 ? (
                <p className={styles.placeholder}>아직 잔잔해요. 첫 파도를 일으켜보세요 🌊</p>
              ) : (
                messageList.items.map((item) => <MessageBubble key={item.message.key} {...item} />)
              )}
            </>
          )}
        </div>

        <div className={styles.composer}>
          {composer.mentionPicker !== undefined ? (
            <MentionPicker {...composer.mentionPicker} />
          ) : null}
          <div
            className={
              composer.isDraftMultiline
                ? `${styles.inputWrap} ${styles.inputWrapMultiline}`
                : styles.inputWrap
            }
          >
            <textarea
              ref={composer.textareaRef}
              className={styles.input}
              value={composer.draft}
              onChange={composer.onChange}
              onKeyDown={composer.onKeyDown}
              onKeyUp={composer.onKeyUp}
              onCompositionStart={composer.onCompositionStart}
              onCompositionEnd={composer.onCompositionEnd}
              onBlur={composer.onBlur}
              placeholder={`#${channelId}에 메시지 보내기`}
              rows={1}
            />
            <button
              type="button"
              className={styles.sendButton}
              onClick={composer.onSend}
              disabled={!composer.canSend}
              aria-label="전송"
            >
              <Send size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {isPanelOverlayOpen ? (
        <PanelBackdrop onClose={thread.onClose} closeLabel="스레드 패널 닫기" />
      ) : null}
      <ThreadPanel
        {...thread}
        className={isPanelOverlayOpen ? `${styles.panel} ${styles.panelOpen}` : styles.panel}
      />
    </div>
  );
}
