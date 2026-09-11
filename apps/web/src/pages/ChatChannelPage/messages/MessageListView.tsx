import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import styles from "../ChatChannelPage.module.css";

export type MessageListViewProps = {
  initialHistoryReady: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

/** 최초 이력 표시만 한 번 이동한다. 통화 바와 공유하는 DOM 참조는 유지한다. */
export function MessageListView({
  initialHistoryReady,
  scrollRef,
  children,
}: MessageListViewProps) {
  const initialPositioned = useRef(false);
  useLayoutEffect(() => {
    if (!initialHistoryReady || initialPositioned.current || scrollRef.current === null) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    initialPositioned.current = true;
  }, [initialHistoryReady, scrollRef]);
  return (
    <div className={styles.messages} ref={scrollRef}>
      {children}
    </div>
  );
}
