import type { StreamMessagesRecoveryPhase } from "./recovery-model.js";
import { getStreamMessagesClientTargetKey, type StreamMessagesClientTarget } from "./target.js";

export type KeyValueStorage = {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

export type StoredStreamMessagesCursor = {
  deliverySyncCursor: number;
  throughSequence: number | null;
  recoveryState: "idle" | "recovery_pending";
};

export type StreamMessagesCursorStorage = {
  clear: () => void;
  load: () => StoredStreamMessagesCursor | null;
  save: (value: StoredStreamMessagesCursor) => void;
};

const STORAGE_VERSION = "v1";

export function createStreamMessagesCursorStorage(input: {
  actorId: string;
  target: StreamMessagesClientTarget;
  storage: KeyValueStorage;
}): StreamMessagesCursorStorage {
  const key = [
    "wake-surfer",
    "stream-messages",
    STORAGE_VERSION,
    encodeURIComponent(assertNonBlank(input.actorId, "actorId")),
    encodeURIComponent(getStreamMessagesClientTargetKey(input.target)),
  ].join(":");

  return {
    clear() {
      input.storage.removeItem(key);
    },
    load() {
      const raw = input.storage.getItem(key);

      if (raw === null) {
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as unknown;

        if (!isStoredCursor(parsed)) {
          input.storage.removeItem(key);
          return null;
        }

        return parsed;
      } catch {
        input.storage.removeItem(key);
        return null;
      }
    },
    save(value) {
      if (!isStoredCursor(value)) {
        throw new TypeError("저장할 Stream Messages cursor가 올바르지 않습니다.");
      }

      input.storage.setItem(
        key,
        JSON.stringify({
          deliverySyncCursor: value.deliverySyncCursor,
          throughSequence: value.throughSequence,
          recoveryState: value.recoveryState,
        }),
      );
    },
  };
}

export function toStoredRecoveryState(
  phase: StreamMessagesRecoveryPhase,
): StoredStreamMessagesCursor["recoveryState"] {
  return phase === "recovery_pending" ? "recovery_pending" : "idle";
}

function isStoredCursor(value: unknown): value is StoredStreamMessagesCursor {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value).sort();

  return (
    JSON.stringify(keys) ===
      JSON.stringify(["deliverySyncCursor", "recoveryState", "throughSequence"]) &&
    Number.isSafeInteger(value.deliverySyncCursor) &&
    (value.deliverySyncCursor as number) >= 0 &&
    (value.throughSequence === null ||
      (Number.isSafeInteger(value.throughSequence) &&
        (value.throughSequence as number) >= (value.deliverySyncCursor as number))) &&
    (value.recoveryState === "idle" || value.recoveryState === "recovery_pending")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonBlank(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${name}는 비어 있을 수 없습니다.`);
  }

  return value;
}
