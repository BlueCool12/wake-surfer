import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  DeletedMessage,
  EditedTextMessage,
} from "@wake-surfer/realtime-chat-message-mutation-contracts";
import {
  disposeStreamMessagesSession,
  Emitter,
  getStreamMessagesSession,
  type KeyValueStorage,
  type StreamMessagesClientTarget,
  type StreamMessagesRecoveryPhase,
  StreamMessagesTransportError,
} from "@wake-surfer/realtime-chat-stream-messages-client";

import type { ChatRoomRuntime } from "./transport/chatTransport";

export type ChatMessageStatus = "pending" | "sent" | "failed";

export type ChatMessageView = {
  key: string;
  idempotencyKey?: string;
  messageId?: string;
  sequence?: number;
  senderId?: string;
  isMine: boolean;
  text: string;
  createdAt: string;
  status: ChatMessageStatus;
  isDeleted: boolean;
  isEdited: boolean;
};

type OptimisticMessage = {
  idempotencyKey: string;
  text: string;
  createdAt: string;
  status: "pending" | "failed";
};

export type ChatRoomModelOptions = {
  actorId: string;
  target: StreamMessagesClientTarget;
  runtime: ChatRoomRuntime;
  storage: KeyValueStorage;
  createIdempotencyKey?: () => string;
  now?: () => string;
};

export class ChatRoomModel extends Emitter {
  readonly options: ChatRoomModelOptions;
  readonly #optimistic = new Map<string, OptimisticMessage>();
  readonly #editedMessageIds = new Set<string>();
  readonly #runtime: ChatRoomRuntime;
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

  constructor(options: ChatRoomModelOptions) {
    super();
    this.options = options;
    this.#runtime = options.runtime;
    this.#createIdempotencyKey = options.createIdempotencyKey ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
    this.streamSession = getStreamMessagesSession({
      actorId: options.actorId,
      storage: options.storage,
      target: options.target,
    });
    this.#subscriptions.push(
      this.streamSession.timeline.subscribe(this.emitViewChange),
      this.streamSession.recovery.subscribe(this.emitViewChange),
    );
  }

  get messages(): ChatMessageView[] {
    return [
      ...this.streamSession.timeline.messages.map((message) => this.#toView(message)),
      ...[...this.#optimistic.values()].map((message) => ({
        key: message.idempotencyKey,
        idempotencyKey: message.idempotencyKey,
        isMine: true,
        text: message.text,
        createdAt: message.createdAt,
        isDeleted: false,
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

    if (trimmed.length === 0) {
      return;
    }

    const idempotencyKey = this.#createIdempotencyKey();
    const createdAt = this.#now();
    this.#optimistic.set(idempotencyKey, {
      idempotencyKey,
      text: trimmed,
      createdAt,
      status: "pending",
    });
    this.emit();
    try {
      this.#runtime.messageTransport.sendMessage({
        idempotencyKey,
        text: trimmed,
      });
    } catch {
      const optimistic = this.#optimistic.get(idempotencyKey);

      if (optimistic !== undefined) {
        optimistic.status = "failed";
        this.emit();
      }
    }
  }

  retryMessage(message: ChatMessageView): void {
    if (message.idempotencyKey === undefined) {
      return;
    }

    const optimistic = this.#optimistic.get(message.idempotencyKey);

    if (optimistic === undefined || optimistic.status !== "failed") {
      return;
    }

    optimistic.status = "pending";
    this.emit();
    try {
      this.#runtime.messageTransport.sendMessage({
        idempotencyKey: optimistic.idempotencyKey,
        text: optimistic.text,
      });
    } catch {
      optimistic.status = "failed";
      this.emit();
    }
  }

  editMessage(message: ChatMessageView, text: string): void {
    const trimmed = text.trim();

    if (
      message.messageId === undefined ||
      !message.isMine ||
      message.status !== "sent" ||
      message.isDeleted ||
      trimmed.length === 0
    ) {
      return;
    }

    this.#runtime.messageTransport.editMessage({
      messageId: message.messageId,
      text: trimmed,
    });
  }

  deleteMessage(message: ChatMessageView): void {
    if (
      message.messageId === undefined ||
      !message.isMine ||
      message.status !== "sent" ||
      message.isDeleted
    ) {
      return;
    }

    this.#runtime.messageTransport.deleteMessage({ messageId: message.messageId });
  }

  discardMessage(message: ChatMessageView): void {
    if (message.idempotencyKey !== undefined && this.#optimistic.delete(message.idempotencyKey)) {
      this.emit();
    }
  }

  dispose(options: { clearCursor: boolean }): void {
    for (const unsubscribe of this.#subscriptions.splice(0)) {
      unsubscribe();
    }

    this.#runtime.messageTransport.disconnect();
    disposeStreamMessagesSession({
      actorId: this.options.actorId,
      clearCursor: options.clearCursor,
      target: this.options.target,
    });
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
        this.#optimistic.delete(response.idempotencyKey);
        this.streamSession.timeline.applyAccepted(response.message);
        this.emit();
      }),
      this.#runtime.messageTransport.onMessageRejected((response) => {
        const optimistic = this.#optimistic.get(response.idempotencyKey);

        if (optimistic !== undefined) {
          optimistic.status = "failed";
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

    for (const optimistic of this.#optimistic.values()) {
      if (optimistic.status === "pending") {
        optimistic.status = "failed";
        changed = true;
      }
    }

    if (changed) {
      this.emit();
    }
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

  #toView(message: PublicMessage): ChatMessageView {
    return {
      key: message.messageId,
      messageId: message.messageId,
      sequence: message.sequence,
      senderId: message.senderActorId,
      isMine: message.senderActorId === this.options.actorId,
      text: message.content?.text ?? "삭제된 메시지입니다.",
      createdAt: message.createdAt,
      isDeleted: message.content === null,
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
