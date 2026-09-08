import styles from "../ChatChannelPage.module.css";

export function OlderMessagesLoadFailureView({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" className={styles.loadOlder} onClick={onRetry}>
      이전 메시지 다시 불러오기
    </button>
  );
}
