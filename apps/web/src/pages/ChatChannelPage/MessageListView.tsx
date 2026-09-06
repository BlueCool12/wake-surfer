import type { ComponentProps, RefObject } from "react";

import Loading from "../../components/Loading";
import MessageBubble from "./MessageBubble";
import styles from "./ChatChannelPage.module.css";

// 뷰 분리를 위한 중간 경계다. 기존 데이터·콜백·요소 참조를 유지한다.
// 구독·스크롤 정책과 메시지별 동작의 소유권 분리는 후속 작업이다.
export type MessageListViewProps = {
  isLoading: boolean;
  isLoadingOlder: boolean;
  olderFailed: boolean;
  hasMoreBefore: boolean;
  recoveryPhase: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  loadOlder: () => void;
  retryRecovery: () => void;
  items: ComponentProps<typeof MessageBubble>[];
};

// 표시와 요소·이벤트 연결만 담당한다. 구독하거나 스크롤 위치를 계산하지 않는다.
export function MessageListView({
  isLoading,
  isLoadingOlder,
  olderFailed,
  hasMoreBefore,
  recoveryPhase,
  scrollRef,
  onScroll,
  loadOlder,
  retryRecovery,
  items,
}: MessageListViewProps) {
  return (
    <div className={styles.messages} ref={scrollRef} onScroll={onScroll}>
      {isLoading ? (
        <Loading />
      ) : (
        <>
          {hasMoreBefore ? (
            <button type="button" className={styles.loadOlder} onClick={loadOlder}>
              {isLoadingOlder
                ? "이전 메시지 불러오는 중…"
                : olderFailed
                  ? "이전 메시지 다시 불러오기"
                  : "이전 메시지 불러오기"}
            </button>
          ) : null}
          {recoveryPhase === "recovery_pending" ? (
            <p className={styles.recoveryNotice}>누락된 메시지를 이어서 복구하고 있어요.</p>
          ) : recoveryPhase === "retryable_failure" ? (
            <button type="button" className={styles.recoveryNotice} onClick={retryRecovery}>
              연결이 잠시 끊겼어요. 복구 시도하기
            </button>
          ) : recoveryPhase === "stream_unavailable" ||
            recoveryPhase === "invalid_cursor" ||
            recoveryPhase === "authentication_failure" ||
            recoveryPhase === "protocol_failure" ? (
            <p className={styles.recoveryError}>메시지 기록을 안전하게 불러오지 못했어요.</p>
          ) : null}
          {items.length === 0 ? (
            <p className={styles.placeholder}>아직 잔잔해요. 첫 파도를 일으켜보세요 🌊</p>
          ) : (
            items.map((item) => <MessageBubble key={item.message.key} {...item} />)
          )}
        </>
      )}
    </div>
  );
}
