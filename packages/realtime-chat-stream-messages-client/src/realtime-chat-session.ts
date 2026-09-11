import type { PublicMessage } from "@wake-surfer/realtime-chat-message-contracts";
import type {
  DeletedMessage,
  EditedTextMessage,
} from "@wake-surfer/realtime-chat-message-mutation-contracts";
import type { KeyValueStorage } from "./cursor-storage.js";
import {
  batchChanges,
  scheduleModelUpdate,
  Emitter,
  ModelReadScope,
  type ReadScope,
  type Unsubscribe,
} from "./emitter.js";
import { StreamMessageProtocolError, StreamMessagesTransportError } from "./errors.js";
import type { StreamMessagesRecoveryPhase } from "./recovery-model.js";
import type { RealtimeChatTargetRuntime } from "./runtime.js";
import { StreamMessagesSessionModel } from "./session-model.js";
import type { StreamMessagesClientTarget } from "./target.js";

export type RealtimeChatMessageStatus = "pending" | "sent" | "failed";
export type RealtimeChatMessageContent = Readonly<NonNullable<PublicMessage["content"]>> | null;
export type RealtimeChatMessage = {
  readonly key: string;
  readonly idempotencyKey?: string | undefined;
  readonly messageId?: string | undefined;
  readonly sequence?: number | undefined;
  readonly senderActorId?: string | undefined;
  readonly isOwn: boolean;
  readonly content: RealtimeChatMessageContent;
  readonly createdAt: string;
  readonly status: RealtimeChatMessageStatus;
  readonly isEdited: boolean;
};

export interface ChatMessage extends RealtimeChatMessage {
  readonly isDeleted: boolean;
  readonly subscribe: (onChange: () => void) => Unsubscribe;
  readonly getVersion: () => number;
  canRetry(): boolean;
  retry(): void;
  canDiscard(): boolean;
  discard(): void;
  canEdit(): boolean;
  edit(text: string): void;
  canDelete(): boolean;
  delete(): void;
}

type LocalMessage = {
  content: RealtimeChatMessageContent;
  createdAt: string;
  status: "pending" | "failed";
};
type MessageOwner = {
  actorId: string;
  active: () => boolean;
  read: (id: string) => PublicMessage | undefined;
  transmit: (message: ManagedChatMessage) => void;
  discard: (message: ManagedChatMessage) => void;
  edit: (message: ManagedChatMessage, text: string) => void;
  delete: (message: ManagedChatMessage) => void;
};

/** 외부에는 읽기와 행동만 공개한다. 서버 본문은 timeline 원본에서 읽는다. */
class ManagedChatMessage extends Emitter implements ChatMessage {
  #local: LocalMessage | undefined;
  #serverId: string | undefined;
  #alias: ManagedChatMessage | undefined;
  #aliasSubscription: Unsubscribe | undefined;
  #discarded = false;
  readonly key: string;
  readonly localId: string | undefined;
  private readonly owner: MessageOwner;

  constructor(
    key: string,
    localId: string | undefined,
    owner: MessageOwner,
    local: LocalMessage | undefined,
    serverId?: string,
  ) {
    super();
    this.key = key;
    this.localId = localId;
    this.owner = owner;
    if (local?.content != null) Object.freeze(local.content);
    this.#local = local;
    this.#serverId = serverId;
  }

  get canonical(): ManagedChatMessage {
    return this.#alias?.canonical ?? this;
  }
  get idempotencyKey(): string | undefined {
    return this.canonical.localId;
  }
  get messageId(): string | undefined {
    return this.canonical.#serverId;
  }
  get #record(): PublicMessage | undefined {
    const id = this.messageId;
    return id === undefined ? undefined : this.owner.read(id);
  }
  get sequence(): number | undefined {
    return this.#record?.sequence;
  }
  get senderActorId(): string | undefined {
    return this.#record?.senderActorId ?? this.owner.actorId;
  }
  get isOwn(): boolean {
    return this.senderActorId === this.owner.actorId;
  }
  get content(): RealtimeChatMessageContent {
    const canonical = this.canonical;
    return canonical.#serverId === undefined ? canonical.#local!.content : this.#record!.content;
  }
  get createdAt(): string {
    const canonical = this.canonical;
    return canonical.#serverId === undefined
      ? canonical.#local!.createdAt
      : this.#record!.createdAt;
  }
  get status(): RealtimeChatMessageStatus {
    return this.messageId === undefined ? this.canonical.#local!.status : "sent";
  }
  get isDeleted(): boolean {
    return this.content === null;
  }
  get isEdited(): boolean {
    const record = this.#record;
    return record !== undefined && record.content !== null && record.editedAt !== undefined;
  }
  get #active(): boolean {
    return this.owner.active() && !this.canonical.#discarded;
  }
  canRetry(): boolean {
    return this.#active && this.status === "failed";
  }
  canDiscard(): boolean {
    return this.canRetry();
  }
  canEdit(): boolean {
    return this.#active && this.isOwn && this.status === "sent" && !this.isDeleted;
  }
  canDelete(): boolean {
    return this.canEdit();
  }
  retry(): void {
    if (this.canRetry()) this.owner.transmit(this.canonical);
  }
  discard(): void {
    if (this.canDiscard()) this.owner.discard(this.canonical);
  }
  edit(text: string): void {
    const trimmed = text.trim();
    if (this.canEdit() && trimmed.length > 0) this.owner.edit(this.canonical, trimmed);
  }
  delete(): void {
    if (this.canDelete()) this.owner.delete(this.canonical);
  }

  changed(): void {
    this.emit();
  }
  setPending(): void {
    if (this.#local?.status === "failed") {
      this.#local.status = "pending";
      this.emit();
    }
  }
  fail(): void {
    if (this.#discarded || this.#serverId !== undefined || this.#local?.status !== "pending")
      return;
    this.#local.status = "failed";
    this.emit();
  }
  accept(serverId: string): void {
    if (this.#serverId === serverId) return;
    this.#serverId = serverId;
    this.#local = undefined;
    this.emit();
  }
  markDiscarded(): void {
    this.#discarded = true;
    this.emit();
  }
  aliasTo(message: ManagedChatMessage): void {
    const canonical = message.canonical;
    if (canonical === this || this.#alias === canonical) return;
    this.#aliasSubscription?.();
    this.#alias = canonical;
    this.#aliasSubscription = canonical.observeChanges(() => this.emit());
    this.emit();
  }
  dispose(): void {
    this.#aliasSubscription?.();
    this.#aliasSubscription = undefined;
    this.clearSubscriptions();
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

export type OlderHistoryState = {
  readonly isLoading: boolean;
  readonly failed: boolean;
  readonly hasMore: boolean;
};

export class RealtimeChatTargetSession extends Emitter {
  readonly options: RealtimeChatTargetSessionOptions;
  readonly streamSession: StreamMessagesSessionModel;
  readonly #allMessages = new Set<ManagedChatMessage>();
  readonly #byUiKey = new Map<string, ManagedChatMessage>();
  readonly #byIdempotencyKey = new Map<string, ManagedChatMessage>();
  readonly #byServerId = new Map<string, ManagedChatMessage>();
  readonly #localOrder = new Set<ManagedChatMessage>();
  readonly #keyScopes = new Map<string, ModelReadScope<ChatMessage | undefined>>();
  readonly #keys: string[] = [];
  readonly #messageKeys = new ModelReadScope<readonly string[]>(() => this.#keys);
  readonly #recovery = new ModelReadScope(() => this.#phase);
  readonly #olderState = { isLoading: false, failed: false, hasMore: false };
  readonly #olderHistory = new ModelReadScope<OlderHistoryState>(() => this.#olderState);
  readonly #initialHistory = new ModelReadScope(() => this.#initialReady);
  readonly #runtime: RealtimeChatTargetRuntime;
  readonly #createIdempotencyKey: () => string;
  readonly #now: () => string;
  readonly #subscriptions: Unsubscribe[] = [];
  readonly #owner: MessageOwner;
  #phase: StreamMessagesRecoveryPhase;
  #initialReady = false;
  #disposed = false;
  #connectionRecoveryAttemptVersion = 0;
  #connectionRecoveryPromise: Promise<void> | undefined;
  #lastRequestedConnectionGeneration: string | undefined;
  #pendingConnectionGeneration: string | undefined;
  #startPromise: Promise<void> | undefined;
  #initialStart: Promise<void> | undefined;
  #messageSubscriptionsAttached = false;

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
    this.#phase = this.streamSession.recovery.phase;
    this.#owner = {
      actorId: options.actorId,
      active: () => !this.#disposed,
      read: (id) => this.streamSession.timeline.getMessage(id),
      transmit: (message) => this.#transmit(message),
      discard: (message) => this.#discard(message),
      edit: (message, text) =>
        this.#runtime.messageTransport.editMessage({ messageId: message.messageId!, text }),
      delete: (message) =>
        this.#runtime.messageTransport.deleteMessage({ messageId: message.messageId! }),
    };
    this.#subscriptions.push(
      this.streamSession.timeline.observeOrder(this.#scheduleKeysRefresh),
      this.streamSession.timeline.observeChanges(() => {
        const hasMore = this.streamSession.timeline.hasMoreBefore;
        if (hasMore !== this.#olderState.hasMore) {
          this.#olderState.hasMore = hasMore;
          this.#olderHistory.changed();
        }
      }),
      this.streamSession.recovery.observeChanges(() => {
        const phase = this.streamSession.recovery.phase;
        if (this.#phase === phase) return;
        this.#phase = phase;
        this.#recovery.changed();
        if (phase === "ready" && !this.#initialReady) {
          this.#initialReady = true;
          this.#initialHistory.changed();
        }
      }),
      this.#messageKeys.observeChanges(() => this.emit()),
      this.#recovery.observeChanges(() => this.emit()),
      this.#olderHistory.observeChanges(() => this.emit()),
      this.#initialHistory.observeChanges(() => this.emit()),
    );
  }

  get messageKeys(): ReadScope<readonly string[]> {
    return this.#messageKeys;
  }
  get recovery(): ReadScope<StreamMessagesRecoveryPhase> {
    return this.#recovery;
  }
  get olderHistory(): ReadScope<OlderHistoryState> {
    return this.#olderHistory;
  }
  get initialHistory(): ReadScope<boolean> {
    return this.#initialHistory;
  }
  message(key: string): ReadScope<ChatMessage | undefined> {
    let scope = this.#keyScopes.get(key);
    if (scope === undefined) {
      scope = new ModelReadScope(() => this.#byUiKey.get(key)?.canonical);
      if (!this.#disposed) this.#keyScopes.set(key, scope);
    }
    return scope;
  }

  // 이전 중인 기존 사용처도 같은 객체와 행동을 사용한다.
  get messages(): ChatMessage[] {
    return this.#keys.map((key) => this.#byUiKey.get(key)!.canonical);
  }
  get recoveryPhase(): StreamMessagesRecoveryPhase {
    return this.#phase;
  }
  get isLoading(): boolean {
    return ["idle", "loading_latest", "recovering", "recovery_pending"].includes(this.#phase);
  }
  get isLoadingOlder(): boolean {
    return this.#olderState.isLoading;
  }
  get olderFailed(): boolean {
    return this.#olderState.failed;
  }
  get hasMoreBefore(): boolean {
    return this.#olderState.hasMore;
  }

  readonly ensureStarted = (): Promise<void> => {
    if (this.#disposed) return Promise.resolve();
    this.#initialStart ??= this.#start();
    return this.#initialStart;
  };
  start(): Promise<void> {
    return this.ensureStarted();
  }
  readonly retryRecovery = (): Promise<void> => {
    if (this.#disposed || this.#phase !== "retryable_failure") return Promise.resolve();
    return this.#start();
  };
  #start(): Promise<void> {
    if (this.#startPromise !== undefined) return this.#startPromise;
    this.#attachMessageSubscriptions();
    // connect가 동기적으로 이벤트를 발생시켜도 시작 기억이 먼저 설정된다.
    const active = Promise.resolve()
      .then(() => this.#runStart())
      .finally(() => {
        if (this.#startPromise === active) this.#startPromise = undefined;
      });
    this.#startPromise = active;
    return active;
  }

  readonly loadOlder = async (): Promise<void> => {
    if (this.#disposed || this.isLoadingOlder || !this.hasMoreBefore) return;
    batchChanges(() => {
      this.#olderState.isLoading = true;
      this.#olderState.failed = false;
      this.#olderHistory.changed();
    });
    try {
      await this.streamSession.loadOlder(this.#runtime.streamMessagesTransport);
    } catch {
      if (!this.#disposed) this.#olderState.failed = true;
    } finally {
      if (!this.#disposed) {
        this.#olderState.isLoading = false;
        this.#olderHistory.changed();
      }
    }
  };

  readonly sendMessage = (text: string): void => {
    const trimmed = text.trim();
    if (this.#disposed || trimmed.length === 0) return;
    const id = this.#createIdempotencyKey();
    if (this.#byIdempotencyKey.has(id)) this.#identityConflict(id);
    const message = new ManagedChatMessage("local:" + id, id, this.#owner, {
      content: { type: "text", text: trimmed },
      createdAt: this.#now(),
      status: "pending",
    });
    batchChanges(() => {
      this.#byIdempotencyKey.set(id, message);
      this.#registerUi(message);
      this.#localOrder.add(message);
      this.#scheduleKeysRefresh();
    });
    this.#transmit(message);
  };

  retryMessage(message: RealtimeChatMessage): void {
    this.#byUiKey.get(message.key)?.retry();
  }
  discardMessage(message: RealtimeChatMessage): void {
    this.#byUiKey.get(message.key)?.discard();
  }
  editMessage(message: RealtimeChatMessage, text: string): void {
    this.#byUiKey.get(message.key)?.edit(text);
  }
  deleteMessage(message: RealtimeChatMessage): void {
    this.#byUiKey.get(message.key)?.delete();
  }

  #registerUi(message: ManagedChatMessage): void {
    this.#allMessages.add(message);
    this.#byUiKey.set(message.key, message);
    this.#subscriptions.push(message.observeChanges(() => this.emit()));
    this.#keyScopes.get(message.key)?.changed();
  }
  #serverMessage(id: string): ManagedChatMessage {
    let message = this.#byServerId.get(id);
    if (message !== undefined) return message;
    message = new ManagedChatMessage("server:" + id, undefined, this.#owner, undefined, id);
    this.#byServerId.set(id, message);
    this.#registerUi(message);
    this.#observeRecord(id);
    return message;
  }
  #observeRecord(id: string): void {
    this.#subscriptions.push(
      this.streamSession.timeline.observeMessage(id, () => {
        this.#byServerId.get(id)?.changed();
      }),
    );
  }
  readonly #scheduleKeysRefresh = (): void => {
    scheduleModelUpdate(this.#refreshKeys);
  };
  readonly #refreshKeys = (): void => {
    if (this.#disposed) return;
    const ordered: string[] = [];
    const visible = new Set<ManagedChatMessage>();
    for (const id of this.streamSession.timeline.messageIds.value) {
      const message = this.#serverMessage(id).canonical;
      visible.add(message);
      ordered.push(message.key);
    }
    for (const message of this.#localOrder) {
      if (visible.has(message)) this.#localOrder.delete(message);
      else ordered.push(message.key);
    }
    if (
      ordered.length === this.#keys.length &&
      ordered.every((key, index) => key === this.#keys[index])
    )
      return;
    this.#keys.splice(0, this.#keys.length, ...ordered);
    this.#messageKeys.changed();
  };
  #transmit(message: ManagedChatMessage): void {
    if (this.#disposed || message.status === "sent" || !this.#localOrder.has(message)) return;
    message.setPending();
    try {
      this.#runtime.messageTransport.sendMessage({
        idempotencyKey: message.idempotencyKey!,
        text: message.content!.text,
      });
    } catch {
      message.fail();
    }
  }
  #discard(message: ManagedChatMessage): void {
    if (!message.canDiscard()) return;
    batchChanges(() => {
      message.markDiscarded();
      this.#localOrder.delete(message);
      // 전송 식별자는 남겨 재사용과 늦은 응답을 구분한다.
      this.#byUiKey.delete(message.key);
      this.#keyScopes.get(message.key)?.changed();
      this.#scheduleKeysRefresh();
    });
  }
  #accept(id: string, record: PublicMessage): void {
    if (this.#disposed) return;
    const local = this.#byIdempotencyKey.get(id);
    const server = this.#byServerId.get(record.messageId);
    if (server?.localId !== undefined && server.localId !== id) this.#identityConflict(id);
    if (
      local !== undefined &&
      ((local.messageId !== undefined && local.messageId !== record.messageId) ||
        (server?.localId !== undefined && server !== local))
    )
      this.#identityConflict(id);

    batchChanges(() => {
      // 원본 검증이 실패하면 객체나 별칭 인덱스도 바꾸지 않는다.
      this.streamSession.timeline.applyAccepted(record);
      if (
        local === undefined ||
        !this.#byUiKey.has(local.key) ||
        local.messageId === record.messageId
      )
        return;
      const previous = this.#byServerId.get(record.messageId);
      this.#byServerId.set(record.messageId, local);
      local.accept(record.messageId);
      if (previous === undefined) this.#observeRecord(record.messageId);
      else if (previous !== local) previous.aliasTo(local);
      this.#byUiKey.set("server:" + record.messageId, local);
      this.#keyScopes.get("server:" + record.messageId)?.changed();

      this.#scheduleKeysRefresh();
    });
  }
  #identityConflict(id: string): never {
    this.streamSession.recovery.setPhase("protocol_failure");
    throw new StreamMessageProtocolError("message_identity_conflict", { idempotencyKey: id });
  }

  dispose(options: { clearCursor: boolean }): void {
    if (this.#disposed) return;
    batchChanges(() => {
      this.#disposed = true;
      this.#pendingConnectionGeneration = undefined;
      for (const message of this.#allMessages) {
        message.fail();
        message.changed();
      }
      this.streamSession.dispose(options);
    });
    for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe();
    for (const message of this.#allMessages) message.dispose();
    for (const scope of this.#keyScopes.values()) scope.clearSubscriptions();
    this.#messageKeys.clearSubscriptions();
    this.#recovery.clearSubscriptions();
    this.#olderHistory.clearSubscriptions();
    this.#initialHistory.clearSubscriptions();
    this.streamSession.timeline.dispose();
    this.streamSession.recovery.clearSubscriptions();
    this.clearSubscriptions();
    this.#runtime.messageTransport.disconnect();
  }

  async #runStart(): Promise<void> {
    if (this.#disposed) return;
    const version = this.#connectionRecoveryAttemptVersion;
    try {
      await this.#runtime.messageTransport.connect();
      if (this.#disposed) return;
      if (this.#connectionRecoveryAttemptVersion === version && this.#phase !== "ready") {
        await this.streamSession.bootstrap(this.#runtime.streamMessagesTransport);
      } else if (this.#connectionRecoveryAttemptVersion !== version) {
        await this.#connectionRecoveryPromise;
      }
      if (!this.#disposed && !this.#runtime.messageTransport.isReady()) {
        this.streamSession.recovery.setPhase("retryable_failure");
      }
    } catch (error) {
      if (this.#disposed) return;
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
    if (this.#messageSubscriptionsAttached) return;
    this.#messageSubscriptionsAttached = true;
    this.#subscriptions.push(
      this.#runtime.messageTransport.onConnectionGenerationChanged(this.#queueConnectionRecovery),
      this.#runtime.messageTransport.onDisconnected(() =>
        batchChanges(() => {
          this.streamSession.recovery.setPhase("retryable_failure");
          for (const message of this.#localOrder) message.fail();
        }),
      ),
      this.#runtime.messageTransport.onMessageCreated((message) =>
        this.streamSession.timeline.applyLive(message),
      ),
      this.#runtime.messageTransport.onMessageAccepted((response) =>
        this.#accept(response.idempotencyKey, response.message),
      ),
      this.#runtime.messageTransport.onMessageRejected((response) =>
        this.#byIdempotencyKey.get(response.idempotencyKey)?.fail(),
      ),
      this.#runtime.messageTransport.onMessageEditResult((response) => {
        if (response.status === "accepted") {
          this.streamSession.timeline.replaceKnown(toPublicEditedMessage(response.message));
        } else if (response.reason === "message_deleted") {
          this.streamSession.timeline.replaceKnown(toPublicDeletedMessage(response.message));
        }
      }),
      this.#runtime.messageTransport.onMessageDeleteResult((response) => {
        if (response.status === "accepted")
          this.streamSession.timeline.replaceKnown(toPublicDeletedMessage(response.message));
      }),
    );
  }
  readonly #queueConnectionRecovery = (generation: string): void => {
    if (this.#disposed || generation === this.#lastRequestedConnectionGeneration) return;
    this.#lastRequestedConnectionGeneration = generation;
    this.#pendingConnectionGeneration = generation;
    this.#connectionRecoveryAttemptVersion += 1;
    if (this.#connectionRecoveryPromise !== undefined) return;
    const active = this.#drainConnectionRecoveryQueue().finally(() => {
      if (this.#connectionRecoveryPromise === active) this.#connectionRecoveryPromise = undefined;
    });
    this.#connectionRecoveryPromise = active;
    void active.catch(() => undefined);
  };
  async #drainConnectionRecoveryQueue(): Promise<void> {
    while (!this.#disposed && this.#pendingConnectionGeneration !== undefined) {
      this.#pendingConnectionGeneration = undefined;
      try {
        await this.streamSession.bootstrap(this.#runtime.streamMessagesTransport);
      } catch (error) {
        if (this.#pendingConnectionGeneration === undefined) throw error;
      }
    }
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
