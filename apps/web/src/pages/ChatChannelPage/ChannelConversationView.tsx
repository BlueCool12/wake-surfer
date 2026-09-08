import type { ReactNode } from "react";

import styles from "./ChatChannelPage.module.css";

type ChannelConversationViewProps = {
  header: ReactNode;
  messageArea: ReactNode;
  composer: ReactNode;
  panel: ReactNode;
  floating: ReactNode;
  isPanelCollapsed: boolean;
};

// 기능별로 완성된 화면을 받아 배치한다. 기능의 상태나 동작을 중계하지 않는다.
export function ChannelConversationView({
  header,
  messageArea,
  composer,
  panel,
  floating,
  isPanelCollapsed,
}: ChannelConversationViewProps) {
  return (
    <div
      className={
        isPanelCollapsed ? `${styles.mainArea} ${styles.mainAreaPanelCollapsed}` : styles.mainArea
      }
    >
      {header}
      {floating}
      <div className={styles.page}>
        {messageArea}
        {composer}
      </div>
      {panel}
    </div>
  );
}
