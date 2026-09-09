import { memo } from "react";
import type { RealtimeChatTargetSession } from "@wake-surfer/realtime-chat-stream-messages-client";
import { useChatScope } from "../../../features/chat/useChatChannel";
import Loading from "../../../components/Loading";
import { MessageRecoveryView } from "./MessageRecoveryView";
import { OlderMessagesLoadView } from "./OlderMessagesLoadView";
import styles from "../ChatChannelPage.module.css";

export const ChatHistoryStatus = memo(function ChatHistoryStatus({
  session,
  empty,
  emptyText,
}: {
  session: RealtimeChatTargetSession;
  empty: boolean;
  emptyText: string;
}) {
  const phase = useChatScope(session.recovery);
  const ready = useChatScope(session.initialHistory);
  const progress = phase === "idle" || phase === "loading_latest" || phase === "recovering";
  return (
    <>
      {progress ? <Loading /> : null}
      <MessageRecoveryView
        phase={phase}
        onRetry={() => {
          void session.retryRecovery().catch(() => undefined);
        }}
      />
      {phase === "cancelled" ? <p className={styles.placeholder}>조회가 중단되었습니다.</p> : null}
      {empty && ready && phase === "ready" ? (
        <p className={styles.placeholder}>{emptyText}</p>
      ) : null}
    </>
  );
});

export const ChatOlderHistory = memo(function ChatOlderHistory({
  session,
}: {
  session: RealtimeChatTargetSession;
}) {
  const state = useChatScope(session.olderHistory);
  return (
    <OlderMessagesLoadView
      hasMoreBefore={state.hasMore}
      isLoadingOlder={state.isLoading}
      olderFailed={state.failed}
      loadOlder={() => {
        void session.loadOlder().catch(() => undefined);
      }}
    />
  );
});
