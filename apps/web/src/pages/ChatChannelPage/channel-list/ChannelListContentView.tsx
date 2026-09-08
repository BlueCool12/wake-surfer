import styles from "./ChannelListContentView.module.css";

type ChannelListContentViewProps = {
  channelId: string;
  /** 부모가 정하는 배치용 클래스(좁은 화면에서는 드로어). */
  className?: string | undefined;
};

/**
 * 채팅방 목록 자리표시자. 방 생성/목록 API가 아직 없어(백엔드 미제공) 현재 입장한
 * 채널 하나만 고정으로 보여준다. 다른 항목이 없으니 클릭 동작도 두지 않는다.
 */
function ChannelListContentView({ channelId, className }: ChannelListContentViewProps) {
  return (
    <nav className={className === undefined ? styles.sidebar : `${styles.sidebar} ${className}`}>
      <div className={styles.item} aria-current="true">
        <span className={styles.hash}>#</span>
        <span className={styles.name}>{channelId}</span>
      </div>
    </nav>
  );
}

export default ChannelListContentView;
