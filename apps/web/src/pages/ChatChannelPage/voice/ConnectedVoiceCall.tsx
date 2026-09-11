import type { ReactNode, RefObject } from "react";

import { useVoiceCall } from "../../../features/voice/useVoiceCall";
import { VoiceCallBarView } from "./VoiceCallBarView";
import { VoiceCallJoinButtonView } from "./VoiceCallJoinButtonView";

type ConnectedVoiceCallProps = {
  roomId: string;
  anchorRef: RefObject<HTMLElement | null>;
  children: (views: { joinButton: ReactNode; callBar: ReactNode }) => ReactNode;
};

// 하나의 통화 모델로 두 화면을 연결한다. 배치 위치가 달라도 통화의 수명은 하나다.
export function ConnectedVoiceCall({ roomId, anchorRef, children }: ConnectedVoiceCallProps) {
  const voice = useVoiceCall(roomId);

  // 후속: 통화 변경마다 대화 JSX가 재구성된다. 단일 모델 생성과 버튼·바의 구독을 분리해야 한다.
  return children({
    joinButton: <VoiceCallJoinButtonView status={voice.status} onJoin={voice.join} />,
    callBar: (
      <VoiceCallBarView
        status={voice.status}
        participants={voice.participants}
        isMuted={voice.isMuted}
        error={voice.error}
        leave={voice.leave}
        toggleMute={voice.toggleMute}
        anchorRef={anchorRef}
      />
    ),
  });
}
