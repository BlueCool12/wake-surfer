import styles from "./ChatChannelPage.module.css";

// 패널 바깥을 덮는 배경이다. 필요한 영역이 조건부로 표시하고, 클릭하면 닫기를 요청한다.
export function PanelBackdropView({
  onClose,
  closeLabel,
}: {
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <button
      type="button"
      className={styles.scrim}
      onClick={onClose}
      aria-label={closeLabel}
      tabIndex={-1}
    />
  );
}
