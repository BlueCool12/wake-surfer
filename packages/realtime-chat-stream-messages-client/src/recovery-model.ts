import { Emitter } from "./emitter.js";

export type StreamMessagesRecoveryPhase =
  | "idle"
  | "loading_latest"
  | "recovering"
  | "recovery_pending"
  | "ready"
  | "stream_unavailable"
  | "invalid_cursor"
  | "retryable_failure"
  | "protocol_failure"
  | "cancelled";

export class StreamMessagesRecoveryModel extends Emitter {
  phase: StreamMessagesRecoveryPhase = "idle";
  throughSequence: number | null = null;

  setPhase(phase: StreamMessagesRecoveryPhase): void {
    if (this.phase === phase) {
      return;
    }

    this.phase = phase;
    this.emit();
  }

  setThroughSequence(throughSequence: number | null): void {
    if (this.throughSequence === throughSequence) {
      return;
    }

    this.throughSequence = throughSequence;
    this.emit();
  }

  restore(phase: StreamMessagesRecoveryPhase, throughSequence: number | null): void {
    this.phase = phase;
    this.throughSequence = throughSequence;
  }
}
