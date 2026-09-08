import styles from "../ChatChannelPage.module.css";

export function MessageRecoveryPendingView() {
  return <p className={styles.recoveryNotice}>누락된 메시지를 이어서 복구하고 있어요.</p>;
}
