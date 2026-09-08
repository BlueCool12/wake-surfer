import { useEffect, useRef } from "react";
import type { ComponentProps, RefObject } from "react";

import Loading from "../../../components/Loading";
import type MessageBubbleView from "./MessageBubbleView";
import styles from "../ChatChannelPage.module.css";
import { MessageItemsView } from "./MessageItemsView";
import { MessageRecoveryView } from "./MessageRecoveryView";
import { OlderMessagesLoadView } from "./OlderMessagesLoadView";

// 통신 상태의 전환과 자동 이동 정책은 외부에서 결정한다.
// View는 상태별 표시, 스크롤 위치 측정, DOM 이동을 담당한다.
// 현재는 표시 데이터 갱신마다 이동 여부를 확인한다. 무관한 재렌더링에 따른 이동 가능성은 남아 있다.
export type MessageListViewProps = {
  isLoading: boolean;
  isLoadingOlder: boolean;
  olderFailed: boolean;
  hasMoreBefore: boolean;
  recoveryPhase: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  shouldFollowLatest: (isNearBottom: boolean) => boolean;
  loadOlder: () => void;
  retryRecovery: () => void;
  items: ComponentProps<typeof MessageBubbleView>[];
};

// 스크롤 참조는 통화 바의 위치 기준과 공유하지만, 측정 상태는 이 View만 소유한다.
export function MessageListView({
  isLoading,
  isLoadingOlder,
  olderFailed,
  hasMoreBefore,
  recoveryPhase,
  scrollRef,
  shouldFollowLatest,
  loadOlder,
  retryRecovery,
  items,
}: MessageListViewProps) {
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !shouldFollowLatest(isAtBottomRef.current)) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, scrollRef, shouldFollowLatest]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el === null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 100;
  };

  return (
    <div className={styles.messages} ref={scrollRef} onScroll={handleScroll}>
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <OlderMessagesLoadView
            hasMoreBefore={hasMoreBefore}
            isLoadingOlder={isLoadingOlder}
            olderFailed={olderFailed}
            loadOlder={loadOlder}
          />
          <MessageRecoveryView phase={recoveryPhase} onRetry={retryRecovery} />
          <MessageItemsView items={items} />
        </>
      )}
    </div>
  );
}
