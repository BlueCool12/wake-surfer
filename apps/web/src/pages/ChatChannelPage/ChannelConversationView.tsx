import type { ComponentProps, ReactNode, RefObject } from "react";
import { Headset, Menu, PanelRight, Send } from "lucide-react";

import ThemeToggle from "../../components/ThemeToggle";
import ThreadPanel from "./ConnectedThreadPanel";
import MentionPicker from "./MentionPicker";
import { VoiceCallBar } from "./VoiceCallBar";
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

// 합의한 후속 방향: 현재 입력 전체가 최종 설계는 아니다.
// - channelId는 서버 리소스 식별자다. 순수 뷰에는 식별자 대신 표시에 필요한 데이터를 전달한다.
// - 채널 목록 열기 버튼은 대화 뷰 밖의 별도 컴포넌트로 분리한다.
// - 헤더의 스레드 열기 버튼을 제거한다. 메시지에서 열고 스레드 패널에서 닫는다.
// - 음성 통화는 독립 기능으로 분리하며, 이번 작업에서는 내부 구현을 변경하지 않는다.
// - 대화 레이아웃에는 기능별 UI를 전달한다. 로딩 등 표시 상태는 해당 기능 내부에서 다룬다.
//   이번 단계에서는 messageArea에 적용하고, 나머지 영역은 후속 작업으로 남긴다.
// - 상태를 열거형으로 통합하는 작업은 미룬다.
type ChannelConversationViewProps = {
  channelId: string;
  onOpenChannelList: () => void;
  onOpenPanel: () => void;
  voice: ComponentProps<typeof VoiceCallBar> & { join: () => void };
  messageArea: ReactNode;
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
  messageArea,
  composer,
  isPanelOverlayOpen,
  thread,
}: ChannelConversationViewProps) {
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
        {messageArea}

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
