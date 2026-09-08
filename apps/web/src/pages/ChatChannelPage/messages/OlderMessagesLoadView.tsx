import styles from "../ChatChannelPage.module.css";
import { OlderMessagesLoadFailureView } from "./OlderMessagesLoadFailureView";

export function OlderMessagesLoadView({
  hasMoreBefore,
  isLoadingOlder,
  olderFailed,
  loadOlder,
}: {
  hasMoreBefore: boolean;
  isLoadingOlder: boolean;
  olderFailed: boolean;
  loadOlder: () => void;
}) {
  if (!hasMoreBefore) return null;

  if (isLoadingOlder) {
    return (
      <button type="button" className={styles.loadOlder} onClick={loadOlder}>
        이전 메시지 불러오는 중…
      </button>
    );
  }

  if (olderFailed) {
    return <OlderMessagesLoadFailureView onRetry={loadOlder} />;
  }

  return (
    <button type="button" className={styles.loadOlder} onClick={loadOlder}>
      이전 메시지 불러오기
    </button>
  );
}
