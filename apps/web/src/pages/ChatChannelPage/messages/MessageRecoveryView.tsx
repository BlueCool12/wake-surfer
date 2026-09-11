import { MessageRecoveryFailureView } from "./MessageRecoveryFailureView";
import { MessageRecoveryPendingView } from "./MessageRecoveryPendingView";
import { MessageRecoveryRetryView } from "./MessageRecoveryRetryView";

export function MessageRecoveryView({ phase, onRetry }: { phase: string; onRetry: () => void }) {
  switch (phase) {
    case "recovery_pending":
      return <MessageRecoveryPendingView />;

    case "retryable_failure":
      return <MessageRecoveryRetryView onRetry={onRetry} />;

    case "stream_unavailable":
    case "invalid_cursor":
    case "authentication_failure":
    case "protocol_failure":
      return <MessageRecoveryFailureView />;

    default:
      return null;
  }
}
