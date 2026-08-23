import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useEffect, useRef } from "react";

import type { UseVoiceCallResult } from "../../features/voice/useVoiceCall";
import type { VoiceParticipant } from "../../features/voice/voiceCallModel";

import styles from "./VoiceCallBar.module.css";

export type VoiceCallBarProps = Pick<
  UseVoiceCallResult,
  "status" | "participants" | "isMuted" | "error" | "leave" | "toggleMute"
>;

export function VoiceCallBar({
  status,
  participants,
  isMuted,
  error,
  leave,
  toggleMute,
}: VoiceCallBarProps) {
  if (status === "idle") {
    return null;
  }

  return (
    <div className={styles.bar} role="status">
      <span className={styles.label}>{describe(status, participants.length, error)}</span>

      {status === "connected" && (
        <button
          type="button"
          className={styles.action}
          onClick={toggleMute}
          aria-pressed={isMuted}
          aria-label={isMuted ? "음소거 해제" : "음소거"}
        >
          {isMuted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
        </button>
      )}

      <button
        type="button"
        className={`${styles.action} ${styles.leave}`}
        onClick={leave}
        aria-label="통화 나가기"
      >
        <PhoneOff size={16} aria-hidden="true" />
      </button>

      {participants.map((participant) => (
        <RemoteAudio key={participant.peerId} participant={participant} />
      ))}
    </div>
  );
}

function describe(status: string, participantCount: number, error: string | undefined): string {
  if (status === "joining") return "통화에 연결 중…";
  if (status === "failed") return error ?? "통화를 시작하지 못했습니다.";
  return participantCount === 0
    ? "통화 중 · 혼자 있습니다"
    : `통화 중 · 상대 ${participantCount}명`;
}

/** `srcObject`는 속성으로 넘길 수 없어 ref로 붙인다. */
function RemoteAudio({ participant }: { participant: VoiceParticipant }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (ref.current !== null) {
      ref.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  return <audio ref={ref} autoPlay className={styles.audio} />;
}
