import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useEffect, useRef } from "react";

import type { RefObject } from "react";

import type { UseVoiceCallResult } from "../../../features/voice/useVoiceCall";
import type { VoiceParticipant } from "../../../features/voice/voiceCallModel";
import { useDraggablePosition } from "../../../hooks/useDraggablePosition";

import styles from "./VoiceCallBarView.module.css";

export type VoiceCallBarViewProps = Pick<
  UseVoiceCallResult,
  "status" | "participants" | "isMuted" | "error" | "leave" | "toggleMute"
> & {
  /** 바가 처음 나타날 자리의 기준. 이 요소의 우측 하단에서 시작한다. */
  anchorRef: RefObject<HTMLElement | null>;
};

/**
 * 통화 중이 아닐 때는 아무것도 마운트하지 않는다.
 *
 * 본체를 별도 컴포넌트로 둔 이유가 있다. 조기 반환 위에서 훅을 부르면, 바가 DOM에 없는 첫 렌더에
 * 시작 위치 계산이 한 번 실패하고 그 뒤로는 의존성이 그대로라 다시 계산되지 않는다.
 */
export function VoiceCallBarView(props: VoiceCallBarViewProps) {
  if (props.status === "idle") {
    return null;
  }

  return <VoiceCallBarBodyView {...props} />;
}

function VoiceCallBarBodyView({
  status,
  participants,
  isMuted,
  error,
  leave,
  toggleMute,
  anchorRef,
}: VoiceCallBarViewProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useDraggablePosition({ ref: barRef, anchorRef });

  return (
    <div
      ref={barRef}
      className={drag.isDragging ? `${styles.bar} ${styles.dragging}` : styles.bar}
      role="status"
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerUp}
      // 좌표가 정해지면 CSS 기본 위치를 버리고 그 값을 쓴다. right까지 꺼야 폭이 늘어나지 않는다.
      style={
        drag.position === undefined
          ? undefined
          : {
              left: drag.position.left,
              top: drag.position.top,
              right: "auto",
              bottom: "auto",
            }
      }
    >
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
        <RemoteAudioView key={participant.peerId} participant={participant} />
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
function RemoteAudioView({ participant }: { participant: VoiceParticipant }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (ref.current !== null) {
      ref.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  return <audio ref={ref} autoPlay className={styles.audio} />;
}
