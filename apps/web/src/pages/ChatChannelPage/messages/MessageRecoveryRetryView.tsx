import styles from "../ChatChannelPage.module.css";

export function MessageRecoveryRetryView({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" className={styles.recoveryNotice} onClick={onRetry}>
      연결이 잠시 끊겼어요. 복구 시도하기
    </button>
  );
}
