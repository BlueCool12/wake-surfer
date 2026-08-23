import { useEffect, useMemo, useSyncExternalStore } from "react";

import { createVoiceCallModel, type VoiceCallSnapshot } from "./voiceCallModel";
import { getVoiceGatewayUrl } from "./voiceRuntime";

export type { VoiceCallStatus, VoiceParticipant } from "./voiceCallModel";

export type UseVoiceCallResult = VoiceCallSnapshot & {
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
};

export function useVoiceCall(roomId: string): UseVoiceCallResult {
  const model = useMemo(
    () => createVoiceCallModel({ gatewayUrl: getVoiceGatewayUrl(), roomId }),
    [roomId],
  );
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);

  // 방을 옮기거나 페이지를 벗어나면 통화를 정리한다. 마이크가 켜진 채 남지 않도록.
  useEffect(() => () => model.leave(), [model]);

  return {
    ...snapshot,
    join: () => void model.join().catch(() => undefined),
    leave: model.leave,
    toggleMute: model.toggleMute,
  };
}
