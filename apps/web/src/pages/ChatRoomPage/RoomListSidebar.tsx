import styles from "./RoomListSidebar.module.css";

type RoomListSidebarProps = {
  channelId: string;
};

/**
 * 채팅방 목록 자리표시자. 방 생성/목록 API가 아직 없어(백엔드 미제공) 현재 입장한
 * 채널 하나만 고정으로 보여준다. 다른 항목이 없으니 클릭 동작도 두지 않는다.
 */
function RoomListSidebar({ channelId }: RoomListSidebarProps) {
  return (
    <nav className={styles.sidebar}>
      <div className={styles.item} aria-current="true">
        <span className={styles.hash}>#</span>
        <span className={styles.name}>{channelId}</span>
      </div>
    </nav>
  );
}

export default RoomListSidebar;
