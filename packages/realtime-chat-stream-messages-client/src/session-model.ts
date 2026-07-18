import type { OlderStreamMessagesHttpRequest } from "@wake-surfer/realtime-chat-stream-messages-contracts";

import {
  createStreamMessagesCursorStorage,
  toStoredRecoveryState,
  type KeyValueStorage,
  type StreamMessagesCursorStorage,
} from "./cursor-storage.js";
import { StreamMessageProtocolError, StreamMessagesTransportError } from "./errors.js";
import { StreamMessagesRecoveryModel } from "./recovery-model.js";
import { StreamMessagesTimelineModel } from "./timeline-model.js";

import type { StreamMessagesTransport } from "./transport.js";

export const MAX_RECOVERY_BATCH_PAGES = 10;
export const MAX_RECOVERY_BATCH_MESSAGES = 500;
export const MAX_RECOVERY_BATCH_UTF8_BYTES = 524_288;

export type StreamMessagesSessionModelOptions = {
  actorId: string;
  channelId: string;
  storage: KeyValueStorage;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  yieldControl?: () => Promise<void>;
};

export class StreamMessagesSessionModel {
  readonly cursorStorage: StreamMessagesCursorStorage;
  readonly recovery = new StreamMessagesRecoveryModel();
  readonly timeline: StreamMessagesTimelineModel;

  readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #yieldControl: () => Promise<void>;
  #activeRecovery: Promise<void> | undefined;
  #abortController: AbortController | undefined;

  constructor(readonly options: StreamMessagesSessionModelOptions) {
    this.timeline = new StreamMessagesTimelineModel(options.channelId);
    this.cursorStorage = createStreamMessagesCursorStorage(options);
    this.#delay = options.delay ?? delayWithAbort;
    this.#yieldControl = options.yieldControl ?? yieldToEventLoop;

    const stored = this.cursorStorage.load();

    if (stored !== null) {
      this.timeline.restoreCursor(stored.deliverySyncCursor);
      this.recovery.restore(stored.recoveryState, stored.throughSequence);
    }
  }

  bootstrap(transport: StreamMessagesTransport): Promise<void> {
    if (this.#activeRecovery !== undefined) {
      return this.#activeRecovery;
    }

    const abortController = new AbortController();
    this.#abortController = abortController;
    const active = this.#runBootstrap(transport, abortController.signal).finally(() => {
      if (this.#activeRecovery === active) {
        this.#activeRecovery = undefined;
        this.#abortController = undefined;
      }
    });
    this.#activeRecovery = active;
    return active;
  }

  async loadOlder(transport: StreamMessagesTransport, limit = 50): Promise<void> {
    const beforeSequence = this.timeline.historyBeforeCursor;

    if (beforeSequence === null || !this.timeline.hasMoreBefore) {
      return;
    }

    const abortController = new AbortController();
    const request: OlderStreamMessagesHttpRequest = {
      channelId: this.options.channelId,
      beforeSequence,
      limit,
    };
    const page = await transport.loadOlder(request, { signal: abortController.signal });
    assertRawByteLength(page.rawUtf8ByteLength);
    this.timeline.applyOlder(page.response);
  }

  cancel(): void {
    this.#abortController?.abort();
    this.recovery.setPhase("cancelled");
  }

  dispose(options: { clearCursor: boolean }): void {
    this.cancel();

    if (options.clearCursor) {
      this.cursorStorage.clear();
    }
  }

  async #runBootstrap(transport: StreamMessagesTransport, signal: AbortSignal): Promise<void> {
    try {
      if (this.timeline.deliverySyncCursor === null) {
        this.recovery.setPhase("loading_latest");
        const latest = await transport.loadLatest(
          { channelId: this.options.channelId },
          { signal },
        );
        assertNotAborted(signal);
        assertRawByteLength(latest.rawUtf8ByteLength);
        this.timeline.applyLatest(latest.response);
        this.recovery.setThroughSequence(null);
        this.#persistCursor("idle");
        this.recovery.setPhase("ready");
        return;
      }

      await this.#recoverAfterCursor(transport, signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        this.recovery.setPhase("cancelled");
        return;
      }

      if (error instanceof StreamMessagesTransportError) {
        if (error.code === "stream_unavailable") {
          this.recovery.setPhase("stream_unavailable");
          return;
        }

        if (error.code === "invalid_cursor") {
          this.recovery.setPhase("invalid_cursor");
          return;
        }

        if (error.retryable) {
          this.recovery.setPhase("retryable_failure");
          return;
        }
      }

      this.recovery.setPhase("protocol_failure");
      throw error;
    }
  }

  async #recoverAfterCursor(
    transport: StreamMessagesTransport,
    signal: AbortSignal,
  ): Promise<void> {
    this.recovery.setPhase("recovering");
    let batchPages = 0;
    let batchMessages = 0;
    let batchBytes = 0;

    while (true) {
      assertNotAborted(signal);
      const afterSequence = this.timeline.deliverySyncCursor!;
      let page;

      try {
        page = await transport.syncAfter(
          {
            channelId: this.options.channelId,
            afterSequence,
            ...(this.recovery.throughSequence === null
              ? {}
              : { throughSequence: this.recovery.throughSequence }),
            limit: 50,
          },
          { signal },
        );
      } catch (error) {
        if (error instanceof StreamMessagesTransportError && error.code === "rate_limited") {
          const retryAfterMs = error.retryAfterMs;

          if (
            retryAfterMs === undefined ||
            !Number.isSafeInteger(retryAfterMs) ||
            retryAfterMs <= 0
          ) {
            throw new StreamMessageProtocolError("sync_no_progress", {
              streamId: this.timeline.streamId,
              retryAfterMs: retryAfterMs ?? "missing",
            });
          }

          this.recovery.setPhase("recovery_pending");
          this.#persistCursor("recovery_pending");
          await this.#delay(retryAfterMs, signal);
          this.recovery.setPhase("recovering");
          continue;
        }

        throw error;
      }

      assertNotAborted(signal);
      assertRawByteLength(page.rawUtf8ByteLength);

      if (this.recovery.throughSequence === null) {
        this.recovery.setThroughSequence(page.response.throughSequence);
      } else if (this.recovery.throughSequence !== page.response.throughSequence) {
        throw new StreamMessageProtocolError("sync_cursor_mismatch", {
          streamId: this.timeline.streamId,
          expectedThroughSequence: this.recovery.throughSequence,
          actualThroughSequence: page.response.throughSequence,
        });
      }

      this.timeline.applySync(page.response);
      batchPages += 1;
      batchMessages += page.response.messages.length;
      batchBytes += page.rawUtf8ByteLength;

      if (!page.response.hasMoreAfter) {
        this.recovery.setThroughSequence(null);
        this.#persistCursor("idle");

        if (this.timeline.hasBufferedGap) {
          batchPages = 0;
          batchMessages = 0;
          batchBytes = 0;
          continue;
        }

        this.recovery.setPhase("ready");
        return;
      }

      this.#persistCursor("idle");

      if (
        batchPages >= MAX_RECOVERY_BATCH_PAGES ||
        batchMessages >= MAX_RECOVERY_BATCH_MESSAGES ||
        batchBytes >= MAX_RECOVERY_BATCH_UTF8_BYTES
      ) {
        this.recovery.setPhase("recovery_pending");
        this.#persistCursor("recovery_pending");
        await this.#yieldControl();
        assertNotAborted(signal);
        batchPages = 0;
        batchMessages = 0;
        batchBytes = 0;
        this.recovery.setPhase("recovering");
      }
    }
  }

  #persistCursor(recoveryState: "idle" | "recovery_pending"): void {
    const deliverySyncCursor = this.timeline.deliverySyncCursor;

    if (deliverySyncCursor === null) {
      return;
    }

    this.cursorStorage.save({
      deliverySyncCursor,
      throughSequence: this.recovery.throughSequence,
      recoveryState:
        recoveryState === "recovery_pending"
          ? "recovery_pending"
          : toStoredRecoveryState(this.recovery.phase),
    });
  }
}

function assertRawByteLength(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("transport raw UTF-8 byte length가 올바르지 않습니다.");
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new StreamMessagesTransportError("cancelled");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function delayWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer);
      reject(new StreamMessagesTransportError("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
