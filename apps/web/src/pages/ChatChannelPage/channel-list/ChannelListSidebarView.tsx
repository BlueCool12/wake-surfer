import ChannelListContentView from "./ChannelListContentView";
import { PanelBackdropView } from "../PanelBackdropView";
import styles from "../ChatChannelPage.module.css";

// 채널 목록의 표시와 배경을 함께 담당한다. isOpen은 좁은 화면에서의 열림 요청이다.
// 화면 폭 기준은 기존 CSS 한 곳에 둔다. 추후 공통 화면 정보가 필요하면 이 컴포넌트에서 읽는다.
export function ChannelListSidebarView({
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
      {isOpen ? <PanelBackdropView onClose={onClose} closeLabel="채널 목록 닫기" /> : null}
      {/* 목록은 계속 유지하고 CSS로 표시한다. 넓은 화면에서는 isOpen과 관계없이 보인다. */}
      <ChannelListContentView
        channelId={channelId}
        className={isOpen ? `${styles.drawer} ${styles.drawerOpen}` : styles.drawer}
      />
    </>
  );
}
