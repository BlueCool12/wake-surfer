import {
  getCanonicalStreamId,
  type PublicMessage,
} from "@wake-surfer/realtime-chat-message-contracts";
import type {
  LatestStreamMessagesResponse,
  OlderStreamMessagesResponse,
  SyncAfterStreamMessagesResponse,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import { batchChanges, Emitter, type Unsubscribe } from "./emitter.js";
import { StreamMessageProtocolError } from "./errors.js";
import {
  copyStreamMessagesClientTarget,
  streamMessagesClientTargetsEqual,
  type StreamMessagesClientTarget,
} from "./target.js";

export interface TimelineReadScope<T> {
  readonly value: T;
  readonly subscribe: (onChange: () => void) => Unsubscribe;
  readonly getVersion: () => number;
}

/** 원본을 복제하지 않고 ID로 읽는다. 변경 권한은 timeline만 가진다. */
class TimelineScope<T> extends Emitter implements TimelineReadScope<T> {
  readonly #read: () => T;

  constructor(read: () => T) {
    super();
    this.#read = read;
  }

  get value(): T {
    return this.#read();
  }

  changed(): void {
    this.emit();
  }
}

export class StreamMessagesTimelineModel extends Emitter {
  readonly #records = new Map<string, PublicMessage>();
  readonly #visibleIds: string[] = [];
  readonly #visibleIdSet = new Set<string>();
  readonly #acceptedOutsideVisible = new Set<string>();
  readonly #messageIdToSequence = new Map<string, number>();
  readonly #sequenceToMessageId = new Map<number, string>();
  readonly #bufferedBySequence = new Map<number, string>();
  readonly #messageScopes = new Map<string, TimelineScope<PublicMessage | undefined>>();
  readonly #messageIds = new TimelineScope<readonly string[]>(() => this.#visibleIds);

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

  get messageIds(): TimelineReadScope<readonly string[]> {
    return this.#messageIds;
  }

  getMessage(messageId: string): PublicMessage | undefined {
    return this.#records.get(messageId);
  }

  message(messageId: string): TimelineReadScope<PublicMessage | undefined> {
    let scope = this.#messageScopes.get(messageId);
    if (scope === undefined) {
      scope = new TimelineScope(() => this.getMessage(messageId));
      this.#messageScopes.set(messageId, scope);
    }
    return scope;
  }

  // 기존 호출부의 읽기 계약. 별도 본문 배열을 상태로 보관하지 않는다.
  get messages(): readonly PublicMessage[] {
    return this.#visibleIds.map((id) => this.#records.get(id)!);
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
    batchChanges(() => {
      for (const message of response.messages) this.#insertLoadedMessage(message);
      this.deliverySyncCursor = response.throughSequence;
      this.#setHistory(response.nextBeforeSequence, response.hasMoreBefore);
      this.#discardBufferedAtOrBeforeCursor();
      this.#drainContiguousBuffer();
    });
  }

  applyOlder(response: OlderStreamMessagesResponse): void {
    this.#assertStream(response.streamId);
    batchChanges(() => {
      for (const message of response.messages) this.#insertLoadedMessage(message);
      this.#setHistory(response.nextBeforeSequence, response.hasMoreBefore);
    });
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
    batchChanges(() => {
      for (const message of response.messages) this.#insertLoadedMessage(message);
      this.deliverySyncCursor = response.nextAfterSequence;
      this.#discardBufferedAtOrBeforeCursor();
      if (!response.hasMoreAfter) this.#drainContiguousBuffer();
    });
  }

  applyLive(message: PublicMessage): void {
    this.#assertMessageTarget(message);
    this.#assertIdentity(message);
    batchChanges(() => {
      const cursor = this.deliverySyncCursor;
      if (cursor === null) {
        this.#bufferMessage(message);
      } else if (message.sequence <= cursor) {
        // 과거의 알 수 없는 알림만으로 표시 범위를 넓히지 않는다.
        return;
      } else if (message.sequence === cursor + 1) {
        this.#insertLoadedMessage(message);
        this.deliverySyncCursor = message.sequence;
        this.#drainContiguousBuffer();
      } else {
        this.#bufferMessage(message);
      }
    });
  }

  applyAccepted(message: PublicMessage): void {
    this.#assertMessageTarget(message);
    this.#assertIdentity(message);
    batchChanges(() => {
      // 수정·삭제 후 오래된 수락이 와도 기존 원본을 우선한다.
      const record = this.#registerRecord(message);
      if (!this.#visibleIdSet.has(record.messageId)) {
        this.#acceptedOutsideVisible.add(record.messageId);
      }
      if (this.deliverySyncCursor !== null && record.sequence <= this.deliverySyncCursor) {
        this.#insertLoadedMessage(record);
      } else {
        this.applyLive(record);
      }
    });
  }

  replaceKnown(message: PublicMessage): void {
    this.#assertMessageTarget(message);
    this.#assertIdentity(message);
    const current = this.#records.get(message.messageId);
    if (current === undefined || messagesEqual(current, message)) return;
    batchChanges(() => {
      this.#records.set(message.messageId, message);
      this.#messageScopes.get(message.messageId)?.changed();
      // 기존 전체 구독은 이전 완료까지 유지한다. 순서 구독에는 알리지 않는다.
      this.emit();
    });
  }

  #setHistory(beforeCursor: number | null, hasMore: boolean): void {
    if (this.historyBeforeCursor === beforeCursor && this.hasMoreBefore === hasMore) return;
    this.historyBeforeCursor = beforeCursor;
    this.hasMoreBefore = hasMore;
    this.emit();
  }

  #registerRecord(message: PublicMessage): PublicMessage {
    const current = this.#records.get(message.messageId);
    if (current !== undefined) return current;
    this.#records.set(message.messageId, message);
    this.#messageIdToSequence.set(message.messageId, message.sequence);
    this.#sequenceToMessageId.set(message.sequence, message.messageId);
    this.#messageScopes.get(message.messageId)?.changed();
    return message;
  }

  #insertLoadedMessage(message: PublicMessage): void {
    this.#assertMessageTarget(message);
    this.#assertIdentity(message);
    const record = this.#registerRecord(message);
    if (this.#visibleIdSet.has(record.messageId)) {
      this.#removeBuffered(record);
      return;
    }

    let insertionIndex = this.#visibleIds.length;
    while (
      insertionIndex > 0 &&
      this.#records.get(this.#visibleIds[insertionIndex - 1]!)!.sequence > record.sequence
    ) {
      insertionIndex -= 1;
    }

    this.#visibleIds.splice(insertionIndex, 0, record.messageId);
    this.#visibleIdSet.add(record.messageId);
    this.#acceptedOutsideVisible.delete(record.messageId);
    this.#removeBuffered(record);
    this.#messageIds.changed();
    this.emit();
  }

  #bufferMessage(message: PublicMessage): void {
    this.#assertIdentity(message);
    if (this.#visibleIdSet.has(message.messageId)) return;
    this.#registerRecord(message);
    this.#bufferedBySequence.set(message.sequence, message.messageId);
  }

  #drainContiguousBuffer(): void {
    if (this.deliverySyncCursor === null) return;
    while (true) {
      const nextSequence: number = this.deliverySyncCursor! + 1;
      const messageId = this.#bufferedBySequence.get(nextSequence);
      if (messageId === undefined) return;
      this.#insertLoadedMessage(this.#records.get(messageId)!);
      this.deliverySyncCursor = nextSequence;
    }
  }

  #discardBufferedAtOrBeforeCursor(): void {
    if (this.deliverySyncCursor === null) return;
    for (const [sequence, messageId] of this.#bufferedBySequence) {
      if (sequence <= this.deliverySyncCursor) {
        const record = this.#records.get(messageId)!;
        // 조회가 수락 메시지의 sequence를 지나도 수락 사실은 표시 목록에 남긴다.
        // delivery cursor는 조회 응답이 정한 값을 유지한다.
        if (this.#acceptedOutsideVisible.has(messageId)) {
          this.#insertLoadedMessage(record);
        } else {
          this.#removeBuffered(record);
        }
      }
    }
  }

  #removeBuffered(message: PublicMessage): void {
    this.#bufferedBySequence.delete(message.sequence);
  }

  #assertIdentity(message: PublicMessage): void {
    const knownMessageId = this.#sequenceToMessageId.get(message.sequence);
    const knownSequence = this.#messageIdToSequence.get(message.messageId);
    if (
      (knownMessageId !== undefined && knownMessageId !== message.messageId) ||
      (knownSequence !== undefined && knownSequence !== message.sequence)
    ) {
      throw new StreamMessageProtocolError("message_identity_conflict", {
        streamId: this.streamId,
        messageId: message.messageId,
        sequence: message.sequence,
      });
    }
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

function messagesEqual(left: PublicMessage, right: PublicMessage): boolean {
  return (
    left.messageId === right.messageId &&
    left.streamId === right.streamId &&
    left.sequence === right.sequence &&
    left.senderActorId === right.senderActorId &&
    // 두 원본의 target은 등록·교체 전에 같은 timeline 대상으로 검증한다.
    left.createdAt === right.createdAt &&
    left.sentAtClient === right.sentAtClient &&
    (left.content === null
      ? right.content === null && left.deletedAt === right.deletedAt
      : right.content !== null &&
        left.content.type === right.content.type &&
        left.content.text === right.content.text &&
        left.editedAt === right.editedAt)
  );
}
