import type { ReactNode } from "react";
import { Menu, PanelRight } from "lucide-react";

import ThemeToggle from "../../components/ThemeToggle";
import styles from "./ChatChannelPage.module.css";

// 채널명과 헤더 버튼을 배치한다. 통화 상태는 참가 버튼이 해석한다.
export function ChannelHeaderView({
  channelName,
  onOpenChannelList,
  onOpenPanel,
  voiceJoinButton,
}: {
  channelName: string;
  onOpenChannelList: () => void;
  onOpenPanel: () => void;
  voiceJoinButton: ReactNode;
}) {
  return (
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
      <h1 className={styles.channelName}>{channelName}</h1>
      {voiceJoinButton}
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
  );
}
