import {
  getCanonicalStreamId,
  type PublicMessage,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  LatestStreamMessagesResponse,
  OlderStreamMessagesResponse,
  SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import { Emitter } from "./emitter.js";
import { StreamMessageProtocolError } from "./errors.js";
import {
  copyStreamMessagesClientTarget,
  streamMessagesClientTargetsEqual,
  type StreamMessagesClientTarget,
} from "./target.js";

export class StreamMessagesTimelineModel extends Emitter {
  readonly #messages: PublicMessage[] = [];
  readonly #messageIdToSequence = new Map<string, number>();
  readonly #sequenceToMessageId = new Map<number, string>();
  readonly #bufferedBySequence = new Map<number, PublicMessage>();
  readonly #bufferedMessageIdToSequence = new Map<string, number>();

  deliverySyncCursor: number | null = null;
  hasMoreBefore = false;
  historyBeforeCursor: number | null = null;

  readonly target: StreamMessagesClientTarget;

  constructor(target: StreamMessagesClientTarget) {
    super();
    this.target = copyStreamMessagesClientTarget(target);
  }

  get streamId(): string {
    return getCanonicalStreamId(this.target);
  }

  get messages(): readonly PublicMessage[] {
    return this.#messages;
  }

  get hasBufferedGap(): boolean {
    return this.#bufferedBySequence.size > 0;
  }

  restoreCursor(cursor: number): void {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new TypeError("복구 cursor는 0 이상의 safe integer여야 합니다.");
    }

    this.deliverySyncCursor = cursor;
  }

  applyLatest(response: LatestStreamMessagesResponse): void {
    this.#assertStream(response.streamId);

    for (const message of response.messages) {
      this.#insertLoadedMessage(message);
    }

    this.deliverySyncCursor = response.throughSequence;
    this.historyBeforeCursor = response.nextBeforeSequence;
    this.hasMoreBefore = response.hasMoreBefore;
    this.#discardBufferedAtOrBeforeCursor();
    this.#drainContiguousBuffer();
    this.emit();
  }

  applyOlder(response: OlderStreamMessagesResponse): void {
    this.#assertStream(response.streamId);

    for (const message of response.messages) {
      this.#insertLoadedMessage(message);
    }

    this.historyBeforeCursor = response.nextBeforeSequence;
    this.hasMoreBefore = response.hasMoreBefore;
    this.emit();
  }

  applySync(response: SyncAfterStreamMessagesResponse): void {
    this.#assertStream(response.streamId);

    if (this.deliverySyncCursor !== response.afterSequence) {
      throw new StreamMessageProtocolError("sync_cursor_mismatch", {
        streamId: this.streamId,
        expectedAfterSequence: this.deliverySyncCursor ?? "missing",
        actualAfterSequence: response.afterSequence,
      });
    }

    if (response.hasMoreAfter && response.nextAfterSequence <= response.afterSequence) {
      throw new StreamMessageProtocolError("sync_no_progress", {
        streamId: this.streamId,
        afterSequence: response.afterSequence,
        nextAfterSequence: response.nextAfterSequence,
      });
    }

    for (const message of response.messages) {
      this.#insertLoadedMessage(message);
    }

    this.deliverySyncCursor = response.nextAfterSequence;
    this.#discardBufferedAtOrBeforeCursor();

    if (!response.hasMoreAfter) {
      this.#drainContiguousBuffer();
    }

    this.emit();
  }

  applyLive(message: PublicMessage): void {
    this.#assertMessageTarget(message);
    const cursor = this.deliverySyncCursor;

    if (cursor === null) {
      this.#bufferMessage(message);
      return;
    }

    if (message.sequence <= cursor) {
      this.#assertKnownIdentityOrDrop(message);
      return;
    }

    if (message.sequence === cursor + 1) {
      this.#insertLoadedMessage(message);
      this.deliverySyncCursor = message.sequence;
      this.#drainContiguousBuffer();
      this.emit();
      return;
    }

    this.#bufferMessage(message);
  }

  applyAccepted(message: PublicMessage): void {
    this.applyLive(message);
  }

  replaceKnown(message: PublicMessage): void {
    this.#assertMessageTarget(message);
    this.#assertIdentity(message);
    const sequence = this.#messageIdToSequence.get(message.messageId);

    if (sequence !== undefined) {
      const index = this.#messages.findIndex(
        (candidate) => candidate.messageId === message.messageId,
      );

      if (index === -1) {
        this.#throwIdentityConflict(message);
      }

      this.#messages[index] = message;
      this.emit();
      return;
    }

    if (this.#bufferedMessageIdToSequence.has(message.messageId)) {
      this.#bufferedBySequence.set(message.sequence, message);
      this.emit();
    }
  }

  #insertLoadedMessage(message: PublicMessage): void {
    this.#assertMessageTarget(message);
    this.#assertIdentity(message);

    if (this.#messageIdToSequence.has(message.messageId)) {
      this.#removeBuffered(message);
      return;
    }

    let insertionIndex = this.#messages.length;

    while (insertionIndex > 0 && this.#messages[insertionIndex - 1]!.sequence > message.sequence) {
      insertionIndex -= 1;
    }

    this.#messages.splice(insertionIndex, 0, message);
    this.#messageIdToSequence.set(message.messageId, message.sequence);
    this.#sequenceToMessageId.set(message.sequence, message.messageId);
    this.#removeBuffered(message);
  }

  #bufferMessage(message: PublicMessage): void {
    this.#assertIdentity(message);

    if (this.#messageIdToSequence.has(message.messageId)) {
      return;
    }

    const bufferedSequence = this.#bufferedMessageIdToSequence.get(message.messageId);
    const bufferedMessage = this.#bufferedBySequence.get(message.sequence);

    if (
      (bufferedSequence !== undefined && bufferedSequence !== message.sequence) ||
      (bufferedMessage !== undefined && bufferedMessage.messageId !== message.messageId)
    ) {
      this.#throwIdentityConflict(message);
    }

    if (bufferedMessage === undefined) {
      this.#bufferedBySequence.set(message.sequence, message);
      this.#bufferedMessageIdToSequence.set(message.messageId, message.sequence);
    }
  }

  #drainContiguousBuffer(): void {
    if (this.deliverySyncCursor === null) {
      return;
    }

    while (true) {
      const nextSequence: number = this.deliverySyncCursor! + 1;
      const message = this.#bufferedBySequence.get(nextSequence);

      if (message === undefined) {
        return;
      }

      this.#insertLoadedMessage(message);
      this.deliverySyncCursor = nextSequence;
    }
  }

  #discardBufferedAtOrBeforeCursor(): void {
    if (this.deliverySyncCursor === null) {
      return;
    }

    for (const [sequence, message] of this.#bufferedBySequence) {
      if (sequence <= this.deliverySyncCursor) {
        this.#assertKnownIdentityOrDrop(message);
        this.#removeBuffered(message);
      }
    }
  }

  #removeBuffered(message: PublicMessage): void {
    this.#bufferedBySequence.delete(message.sequence);
    this.#bufferedMessageIdToSequence.delete(message.messageId);
  }

  #assertKnownIdentityOrDrop(message: PublicMessage): void {
    const knownMessageId = this.#sequenceToMessageId.get(message.sequence);
    const knownSequence = this.#messageIdToSequence.get(message.messageId);

    if (
      (knownMessageId !== undefined && knownMessageId !== message.messageId) ||
      (knownSequence !== undefined && knownSequence !== message.sequence)
    ) {
      this.#throwIdentityConflict(message);
    }
  }

  #assertIdentity(message: PublicMessage): void {
    const knownMessageId = this.#sequenceToMessageId.get(message.sequence);
    const knownSequence = this.#messageIdToSequence.get(message.messageId);
    const bufferedMessage = this.#bufferedBySequence.get(message.sequence);
    const bufferedSequence = this.#bufferedMessageIdToSequence.get(message.messageId);

    if (
      (knownMessageId !== undefined && knownMessageId !== message.messageId) ||
      (knownSequence !== undefined && knownSequence !== message.sequence) ||
      (bufferedMessage !== undefined && bufferedMessage.messageId !== message.messageId) ||
      (bufferedSequence !== undefined && bufferedSequence !== message.sequence)
    ) {
      this.#throwIdentityConflict(message);
    }
  }

  #throwIdentityConflict(message: PublicMessage): never {
    throw new StreamMessageProtocolError("message_identity_conflict", {
      streamId: this.streamId,
      messageId: message.messageId,
      sequence: message.sequence,
    });
  }

  #assertStream(streamId: string): void {
    if (streamId !== this.streamId) {
      throw new StreamMessageProtocolError("message_target_mismatch", {
        expectedStreamId: this.streamId,
        actualStreamId: streamId,
      });
    }
  }

  #assertMessageTarget(message: PublicMessage): void {
    if (
      message.streamId !== this.streamId ||
      !streamMessagesClientTargetsEqual(this.target, message.target)
    ) {
      throw new StreamMessageProtocolError("message_target_mismatch", {
        expectedStreamId: this.streamId,
        actualStreamId: message.streamId,
        messageId: message.messageId,
        sequence: message.sequence,
      });
    }
  }
}
