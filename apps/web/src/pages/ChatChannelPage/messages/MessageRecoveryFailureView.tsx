import styles from "../ChatChannelPage.module.css";

export function MessageRecoveryFailureView() {
  return <p className={styles.recoveryError}>메시지 기록을 안전하게 불러오지 못했어요.</p>;
}
