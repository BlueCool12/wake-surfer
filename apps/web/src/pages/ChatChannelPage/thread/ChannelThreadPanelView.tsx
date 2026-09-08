import type { ReactNode } from "react";

import { PanelBackdropView } from "../PanelBackdropView";

// 전달받은 패널과 닫기 배경을 배치한다. 숨겨진 패널도 마운트 상태를 유지한다.
export function ChannelThreadPanelView({
  panel,
  isOverlayOpen,
  onClose,
}: {
  panel: ReactNode;
  isOverlayOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {isOverlayOpen ? <PanelBackdropView onClose={onClose} closeLabel="스레드 패널 닫기" /> : null}
      {panel}
    </>
  );
}
