import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  DeletedMessage,
  EditedTextMessage,
} from "@wake-surfer/realtime-chat-message-mutation-contracts";
import type { KeyValueStorage } from "./cursor-storage.js";
import { Emitter } from "./emitter.js";
import { StreamMessagesTransportError } from "./errors.js";
import type { StreamMessagesRecoveryPhase } from "./recovery-model.js";
import type { RealtimeChatTargetRuntime } from "./runtime.js";
import { StreamMessagesSessionModel } from "./session-model.js";
import type { StreamMessagesClientTarget } from "./target.js";

export type RealtimeChatMessageStatus = "pending" | "sent" | "failed";

export type RealtimeChatMessage = {
  key: string;
  idempotencyKey?: string;
  messageId?: string;
  sequence?: number;
  senderActorId?: string;
  isOwn: boolean;
  content: PublicMessage["content"];
  createdAt: string;
  status: RealtimeChatMessageStatus;
  isEdited: boolean;
};

/** 미확정 전송 메시지의 상태와 재전송·버리기 규칙을 소유한다. 통신과 목록 변경은 세션에 요청한다. */
class OutgoingChatMessage {
  readonly idempotencyKey: string;
  readonly text: string;
  readonly createdAt: string;
  readonly #send: () => void;
  readonly #discard: () => void;
  readonly #onChange: () => void;
  #status: "pending" | "failed" = "pending";
  #started = false;
  #settled = false;

  constructor(options: {
    idempotencyKey: string;
    text: string;
    createdAt: string;
    send: () => void;
    discard: () => void;
    onChange: () => void;
  }) {
    this.idempotencyKey = options.idempotencyKey;
    this.text = options.text;
    this.createdAt = options.createdAt;
    this.#send = options.send;
    this.#discard = options.discard;
    this.#onChange = options.onChange;
  }

  get status(): "pending" | "failed" {
    return this.#status;
  }

  canRetry(): boolean {
    return !this.#settled && this.#status === "failed";
  }

  canDiscard(): boolean {
    return !this.#settled && this.#status === "failed";
  }

  send(): void {
    if (this.#started || this.#settled) return;
    this.#started = true;
    this.#transmit();
  }

  retry(): void {
    if (!this.canRetry()) return;
    this.#transmit();
  }

  discard(): void {
    if (!this.canDiscard()) return;
    this.#settled = true;
    this.#discard();
    this.#onChange();
  }

  // 여러 메시지가 함께 실패할 때 세션이 변경 알림을 한 번으로 묶을 수 있도록 결과를 돌려준다.
  markFailed(): boolean {
    if (this.#settled || this.#status !== "pending") return false;
    this.#status = "failed";
    return true;
  }

  // 서버가 수락한 뒤에는 이 미확정 전송 객체로 다시 보내거나 버릴 수 없다.
  markAccepted(): void {
    this.#settled = true;
  }

  #transmit(): void {
    this.#status = "pending";
    this.#onChange();
    try {
      this.#send();
    } catch {
      if (this.markFailed()) {
        this.#onChange();
      }
    }
  }
}

export type RealtimeChatTargetSessionOptions = {
  actorId: string;
  target: StreamMessagesClientTarget;
  runtime: RealtimeChatTargetRuntime;
  storage: KeyValueStorage;
  createIdempotencyKey?: () => string;
  now?: () => string;
};

export class RealtimeChatTargetSession extends Emitter {
  readonly options: RealtimeChatTargetSessionOptions;
  readonly #optimistic = new Map<string, OutgoingChatMessage>();
  readonly #editedMessageIds = new Set<string>();
  readonly #runtime: RealtimeChatTargetRuntime;
  readonly #createIdempotencyKey: () => string;
  readonly #now: () => string;
  readonly #subscriptions: Array<() => void> = [];
  readonly streamSession;
  #connectionRecoveryAttemptVersion = 0;
  #connectionRecoveryPromise: Promise<void> | undefined;
  #lastRequestedConnectionGeneration: string | undefined;
  #pendingConnectionGeneration: string | undefined;
  #startPromise: Promise<void> | undefined;
  #messageSubscriptionsAttached = false;
  #loadingOlder = false;
  #olderFailed = false;

  constructor(options: RealtimeChatTargetSessionOptions) {
    super();
    this.options = options;
    this.#runtime = options.runtime;
    this.#createIdempotencyKey = options.createIdempotencyKey ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
    this.streamSession = new StreamMessagesSessionModel({
      actorId: options.actorId,
      storage: options.storage,
      target: options.target,
    });
    this.#subscriptions.push(
      this.streamSession.timeline.subscribe(this.emitViewChange),
      this.streamSession.recovery.subscribe(this.emitViewChange),
    );
  }

  get messages(): RealtimeChatMessage[] {
    return [
      ...this.streamSession.timeline.messages.map((message) => this.#toMessage(message)),
      ...[...this.#optimistic.values()].map((message) => ({
        key: message.idempotencyKey,
        idempotencyKey: message.idempotencyKey,
        isOwn: true,
        content: { type: "text" as const, text: message.text },
        createdAt: message.createdAt,
        isEdited: false,
        status: message.status,
      })),
    ];
  }

  get recoveryPhase(): StreamMessagesRecoveryPhase {
    return this.streamSession.recovery.phase;
  }

  get isLoading(): boolean {
    return (
      this.recoveryPhase === "idle" ||
      this.recoveryPhase === "loading_latest" ||
      this.recoveryPhase === "recovering"
    );
  }

  get isLoadingOlder(): boolean {
    return this.#loadingOlder;
  }

  get olderFailed(): boolean {
    return this.#olderFailed;
  }

  get hasMoreBefore(): boolean {
    return this.streamSession.timeline.hasMoreBefore;
  }

  readonly emitViewChange = (): void => {
    this.emit();
  };

  start(): Promise<void> {
    if (this.#startPromise !== undefined) {
      return this.#startPromise;
    }

    this.#attachMessageSubscriptions();
    const active = this.#runStart().finally(() => {
      if (this.#startPromise === active) {
        this.#startPromise = undefined;
      }
    });
    this.#startPromise = active;
    return active;
  }

  async loadOlder(): Promise<void> {
    if (this.#loadingOlder || !this.hasMoreBefore) {
      return;
    }

    this.#loadingOlder = true;
    this.#olderFailed = false;
    this.emit();

    try {
      await this.streamSession.loadOlder(this.#runtime.streamMessagesTransport);
    } catch {
      this.#olderFailed = true;
    } finally {
      this.#loadingOlder = false;
      this.emit();
    }
  }

  sendMessage(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const idempotencyKey = this.#createIdempotencyKey();
    const message = new OutgoingChatMessage({
      idempotencyKey,
      text: trimmed,
      createdAt: this.#now(),
      send: () => this.#runtime.messageTransport.sendMessage({ idempotencyKey, text: trimmed }),
      discard: () => {
        this.#optimistic.delete(idempotencyKey);
      },
      onChange: this.emitViewChange,
    });
    this.#optimistic.set(idempotencyKey, message);
    message.send();
  }

  retryMessage(message: RealtimeChatMessage): void {
    if (message.idempotencyKey === undefined) return;
    this.#optimistic.get(message.idempotencyKey)?.retry();
  }

  editMessage(message: RealtimeChatMessage, text: string): void {
    const trimmed = text.trim();

    if (
      message.messageId === undefined ||
      !message.isOwn ||
      message.status !== "sent" ||
      message.content === null ||
      trimmed.length === 0
    ) {
      return;
    }

    this.#runtime.messageTransport.editMessage({
      messageId: message.messageId,
      text: trimmed,
    });
  }

  deleteMessage(message: RealtimeChatMessage): void {
    if (
      message.messageId === undefined ||
      !message.isOwn ||
      message.status !== "sent" ||
      message.content === null
    ) {
      return;
    }

    this.#runtime.messageTransport.deleteMessage({ messageId: message.messageId });
  }

  discardMessage(message: RealtimeChatMessage): void {
    if (message.idempotencyKey === undefined) return;
    this.#optimistic.get(message.idempotencyKey)?.discard();
  }

  dispose(options: { clearCursor: boolean }): void {
    for (const unsubscribe of this.#subscriptions.splice(0)) {
      unsubscribe();
    }

    this.#runtime.messageTransport.disconnect();
    this.streamSession.dispose({ clearCursor: options.clearCursor });
  }

  async #runStart(): Promise<void> {
    const recoveryAttemptVersionBeforeConnect = this.#connectionRecoveryAttemptVersion;

    try {
      await this.#runtime.messageTransport.connect();

      if (
        this.#connectionRecoveryAttemptVersion === recoveryAttemptVersionBeforeConnect &&
        this.recoveryPhase !== "ready"
      ) {
        await this.streamSession.bootstrap(this.#runtime.streamMessagesTransport);
      } else if (this.#connectionRecoveryAttemptVersion !== recoveryAttemptVersionBeforeConnect) {
        await this.#connectionRecoveryPromise;
      }

      if (!this.#runtime.messageTransport.isReady()) {
        this.streamSession.recovery.setPhase("retryable_failure");
      }
    } catch (error) {
      this.streamSession.recovery.setPhase(
        error instanceof StreamMessagesTransportError && error.code === "ticket_rejected"
          ? "authentication_failure"
          : error instanceof StreamMessagesTransportError && error.retryable
            ? "retryable_failure"
            : "protocol_failure",
      );
      throw error;
    }
  }

  #attachMessageSubscriptions(): void {
    if (this.#messageSubscriptionsAttached) {
      return;
    }

    this.#messageSubscriptionsAttached = true;
    this.#subscriptions.push(
      this.#runtime.messageTransport.onConnectionGenerationChanged(this.#queueConnectionRecovery),
      this.#runtime.messageTransport.onDisconnected(this.#handleDisconnected),
      this.#runtime.messageTransport.onMessageCreated((message) => {
        this.streamSession.timeline.applyLive(message);
      }),
      this.#runtime.messageTransport.onMessageAccepted((response) => {
        this.#optimistic.get(response.idempotencyKey)?.markAccepted();
        this.#optimistic.delete(response.idempotencyKey);
        this.streamSession.timeline.applyAccepted(response.message);
        this.emit();
      }),
      this.#runtime.messageTransport.onMessageRejected((response) => {
        if (this.#optimistic.get(response.idempotencyKey)?.markFailed()) {
          this.emit();
        }
      }),
      this.#runtime.messageTransport.onMessageEditResult((response) => {
        if (response.status === "accepted") {
          this.#editedMessageIds.add(response.message.messageId);
          this.streamSession.timeline.replaceKnown(toPublicEditedMessage(response.message));
        } else if (response.reason === "message_deleted") {
          this.#editedMessageIds.delete(response.message.messageId);
          this.streamSession.timeline.replaceKnown(toPublicDeletedMessage(response.message));
        }
      }),
      this.#runtime.messageTransport.onMessageDeleteResult((response) => {
        if (response.status === "accepted") {
          this.#editedMessageIds.delete(response.message.messageId);
          this.streamSession.timeline.replaceKnown(toPublicDeletedMessage(response.message));
        }
      }),
    );
  }

  readonly #handleDisconnected = (): void => {
    this.streamSession.recovery.setPhase("retryable_failure");
    this.#markPendingMessagesFailed();
  };

  readonly #markPendingMessagesFailed = (): void => {
    let changed = false;
    for (const message of this.#optimistic.values()) {
      if (message.markFailed()) changed = true;
    }
    if (changed) this.emit();
  };

  readonly #queueConnectionRecovery = (connectionGeneration: string): void => {
    if (connectionGeneration === this.#lastRequestedConnectionGeneration) {
      return;
    }

    this.#lastRequestedConnectionGeneration = connectionGeneration;
    this.#pendingConnectionGeneration = connectionGeneration;
    this.#connectionRecoveryAttemptVersion += 1;

    if (this.#connectionRecoveryPromise !== undefined) {
      return;
    }

    const active = this.#drainConnectionRecoveryQueue().finally(() => {
      if (this.#connectionRecoveryPromise === active) {
        this.#connectionRecoveryPromise = undefined;
      }
    });
    this.#connectionRecoveryPromise = active;
    void active.catch(() => undefined);
  };

  async #drainConnectionRecoveryQueue(): Promise<void> {
    while (this.#pendingConnectionGeneration !== undefined) {
      this.#pendingConnectionGeneration = undefined;

      try {
        await this.streamSession.bootstrap(this.#runtime.streamMessagesTransport);
      } catch (error) {
        if (this.#pendingConnectionGeneration === undefined) {
          throw error;
        }
      }
    }
  }

  #toMessage(message: PublicMessage): RealtimeChatMessage {
    return {
      key: message.messageId,
      messageId: message.messageId,
      sequence: message.sequence,
      senderActorId: message.senderActorId,
      isOwn: message.senderActorId === this.options.actorId,
      content: message.content,
      createdAt: message.createdAt,
      isEdited:
        (message.content !== null && message.editedAt !== undefined) ||
        this.#editedMessageIds.has(message.messageId),
      status: "sent",
    };
  }
}

function toPublicEditedMessage(message: EditedTextMessage): PublicMessage {
  return {
    messageId: message.messageId,
    streamId: message.streamId,
    sequence: message.sequence,
    senderActorId: message.senderActorId,
    target: message.target,
    content: { type: "text", text: message.text },
    createdAt: message.createdAt,
    editedAt: message.editedAt,
  };
}

function toPublicDeletedMessage(message: DeletedMessage): PublicMessage {
  return {
    messageId: message.messageId,
    streamId: message.streamId,
    sequence: message.sequence,
    senderActorId: message.senderActorId,
    target: message.target,
    content: null,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
  };
}
