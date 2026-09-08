import type { ComponentProps } from "react";
import { Headset } from "lucide-react";

import type { VoiceCallBarView } from "./VoiceCallBarView";
import styles from "../ChatChannelPage.module.css";

// 참가 상태에 따른 버튼 표시와 활성화를 결정한다. 음소거·나가기는 통화 바가 담당한다.
export function VoiceCallJoinButtonView({
  status,
  onJoin,
}: {
  status: ComponentProps<typeof VoiceCallBarView>["status"];
  onJoin: () => void;
}) {
  const isConnected = status === "connected";

  return (
    <button
      type="button"
      className={styles.callButton}
      onClick={onJoin}
      disabled={status === "joining" || isConnected}
      aria-pressed={isConnected}
      aria-label={isConnected ? "음성 통화 참가 중" : "음성 통화 참가"}
    >
      <Headset size={16} aria-hidden="true" />
    </button>
  );
}
