import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import {
  disposeStreamMessagesSession,
  Emitter,
  getStreamMessagesSession,
  type KeyValueStorage,
  type StreamMessagesRecoveryPhase,
  StreamMessagesTransportError,
} from "@wake-surfer/realtime-chat-stream-messages-client";

import type { ChatRoomRuntime } from "./transport/chatTransport";

export type ChatMessageStatus = "pending" | "sent" | "failed";

export type ChatMessageView = {
  key: string;
  clientMessageId?: string;
  messageId?: string;
  sequence?: number;
  senderId?: string;
  isMine: boolean;
  text: string;
  createdAt: string;
  status: ChatMessageStatus;
};

type OptimisticMessage = {
  clientMessageId: string;
  text: string;
  createdAt: string;
  status: "pending" | "failed";
};

export type ChatRoomModelOptions = {
  actorId: string;
  channelId: string;
  runtime: ChatRoomRuntime;
  storage: KeyValueStorage;
  createClientMessageId?: () => string;
  now?: () => string;
};

export class ChatRoomModel extends Emitter {
  readonly options: ChatRoomModelOptions;
  readonly #optimistic = new Map<string, OptimisticMessage>();
  readonly #runtime: ChatRoomRuntime;
  readonly #createClientMessageId: () => string;
  readonly #now: () => string;
  readonly #subscriptions: Array<() => void> = [];
  readonly streamSession;
  #startPromise: Promise<void> | undefined;
  #messageSubscriptionsAttached = false;
  #loadingOlder = false;
  #olderFailed = false;

  constructor(options: ChatRoomModelOptions) {
    super();
    this.options = options;
    this.#runtime = options.runtime;
    this.#createClientMessageId = options.createClientMessageId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
    this.streamSession = getStreamMessagesSession({
      actorId: options.actorId,
      channelId: options.channelId,
      storage: options.storage,
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
        key: message.clientMessageId,
        clientMessageId: message.clientMessageId,
        isMine: true,
        text: message.text,
        createdAt: message.createdAt,
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
      if (this.#startPromise === active && this.recoveryPhase !== "ready") {
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

    const clientMessageId = this.#createClientMessageId();
    this.#optimistic.set(clientMessageId, {
      clientMessageId,
      text: trimmed,
      createdAt: this.#now(),
      status: "pending",
    });
    this.emit();
    this.#runtime.messageTransport.sendChannelMessage({
      clientMessageId,
      content: { type: "text", text: trimmed },
    });
  }

  retryMessage(message: ChatMessageView): void {
    if (message.clientMessageId === undefined) {
      return;
    }

    const optimistic = this.#optimistic.get(message.clientMessageId);

    if (optimistic === undefined || optimistic.status !== "failed") {
      return;
    }

    optimistic.status = "pending";
    this.emit();
    this.#runtime.messageTransport.sendChannelMessage({
      clientMessageId: optimistic.clientMessageId,
      content: { type: "text", text: optimistic.text },
    });
  }

  dispose(options: { clearCursor: boolean }): void {
    for (const unsubscribe of this.#subscriptions.splice(0)) {
      unsubscribe();
    }

    this.#runtime.messageTransport.disconnect();
    disposeStreamMessagesSession({
      actorId: this.options.actorId,
      channelId: this.options.channelId,
      clearCursor: options.clearCursor,
    });
  }

  async #runStart(): Promise<void> {
    try {
      await this.#runtime.messageTransport.connect();
      await this.streamSession.bootstrap(this.#runtime.streamMessagesTransport);
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
      this.#runtime.messageTransport.onMessageCreated((message) => {
        this.streamSession.timeline.applyLive(message);
      }),
      this.#runtime.messageTransport.onMessageAccepted((response) => {
        this.#optimistic.delete(response.clientMessageId);
        this.streamSession.timeline.applyAccepted(response.message);
        this.emit();
      }),
      this.#runtime.messageTransport.onMessageRejected((response) => {
        const optimistic = this.#optimistic.get(response.clientMessageId);

        if (optimistic !== undefined) {
          optimistic.status = "failed";
          this.emit();
        }
      }),
    );
  }

  #toView(message: PublicMessage): ChatMessageView {
    return {
      key: message.messageId,
      messageId: message.messageId,
      sequence: message.sequence,
      senderId: message.senderActorId,
      isMine: message.senderActorId === this.options.actorId,
      text: message.content.text,
      createdAt: message.createdAt,
      status: "sent",
    };
  }
}
