import {
  getCanonicalStreamId,
  type ChatMessage,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  LatestStreamMessagesResponse,
  OlderStreamMessagesResponse,
  SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import { Emitter } from "./emitter.js";
import { StreamMessageProtocolError } from "./errors.js";

export class StreamMessagesTimelineModel extends Emitter {
  readonly #messages: ChatMessage[] = [];
  readonly #messageIdToSequence = new Map<string, number>();
  readonly #sequenceToMessageId = new Map<number, string>();
  readonly #bufferedBySequence = new Map<number, ChatMessage>();
  readonly #bufferedMessageIdToSequence = new Map<string, number>();

  deliverySyncCursor: number | null = null;
  hasMoreBefore = false;
  historyBeforeCursor: number | null = null;

  constructor(readonly channelId: string) {
    super();
  }

  get streamId(): string {
    return getCanonicalStreamId({ type: "channel", channelId: this.channelId });
  }

  get messages(): readonly ChatMessage[] {
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

  applyLive(message: ChatMessage): void {
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

  applyAccepted(message: ChatMessage): void {
    this.applyLive(message);
  }

  #insertLoadedMessage(message: ChatMessage): void {
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

  #bufferMessage(message: ChatMessage): void {
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

  #removeBuffered(message: ChatMessage): void {
    this.#bufferedBySequence.delete(message.sequence);
    this.#bufferedMessageIdToSequence.delete(message.messageId);
  }

  #assertKnownIdentityOrDrop(message: ChatMessage): void {
    const knownMessageId = this.#sequenceToMessageId.get(message.sequence);
    const knownSequence = this.#messageIdToSequence.get(message.messageId);

    if (
      (knownMessageId !== undefined && knownMessageId !== message.messageId) ||
      (knownSequence !== undefined && knownSequence !== message.sequence)
    ) {
      this.#throwIdentityConflict(message);
    }
  }

  #assertIdentity(message: ChatMessage): void {
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

  #throwIdentityConflict(message: ChatMessage): never {
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

  #assertMessageTarget(message: ChatMessage): void {
    if (
      message.streamId !== this.streamId ||
      message.target.type !== "channel" ||
      message.target.channelId !== this.channelId
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
