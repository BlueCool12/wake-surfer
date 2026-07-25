import {
  GatewayConnectedEventSchema,
  IssueGatewayTicketResponseSchema,
  type IssueGatewayTicketResponse,
} from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import {
  ChatStreamSyncEventSchema,
  RequestIdSchema,
  type ChatStreamSyncEvent,
} from "@wake-surfer/realtime-chat-stream-messages-contracts";

import { Emitter } from "./emitter.js";
import { StreamMessagesTransportError } from "./errors.js";

import type { AuthenticatedStreamMessagesRealtimeSession } from "./browser-transport.js";

export const DEFAULT_GATEWAY_CONNECTED_TIMEOUT_MS = 10_000;
export const DEFAULT_REALTIME_RECONNECT_BASE_DELAY_MS = 250;
export const DEFAULT_REALTIME_RECONNECT_MAX_DELAY_MS = 4_000;
export const DEFAULT_REALTIME_MAX_IMMEDIATE_RETRIES = 3;

export type GatewayTicketIssuer = {
  issue: (context: { signal: AbortSignal }) => Promise<IssueGatewayTicketResponse>;
};

export type RealtimeEventName =
  | "gateway.connected"
  | "chat.stream.sync"
  | "chat.stream.synced"
  | "chat.stream.sync.rejected"
  | "chat.stream.sync.failed";

export type RealtimeEventSocket = {
  close: () => void;
  connect: () => void;
  emit: (eventName: string, rawPayload: string) => void;
  on: (eventName: string, listener: (rawPayload: string) => void) => () => void;
  onClose: (listener: () => void) => () => void;
};

export type RealtimeEventSocketFactory = (context: {
  clientConnectionGeneration: string;
  gatewayUrl: string;
  ticket: string;
}) => RealtimeEventSocket;

export type AuthenticatedRealtimeSessionModelOptions = {
  actorSessionNamespace: string;
  connectedTimeoutMilliseconds?: number;
  createSocket: RealtimeEventSocketFactory;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  maxImmediateRetries?: number;
  reconnectBaseDelayMilliseconds?: number;
  reconnectMaxDelayMilliseconds?: number;
  ticketIssuer: GatewayTicketIssuer;
};

export class AuthenticatedRealtimeSessionModel
  extends Emitter
  implements AuthenticatedStreamMessagesRealtimeSession
{
  readonly options: AuthenticatedRealtimeSessionModelOptions;
  readonly #connectedTimeoutMilliseconds: number;
  readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #maxImmediateRetries: number;
  readonly #reconnectBaseDelayMilliseconds: number;
  readonly #reconnectMaxDelayMilliseconds: number;
  readonly #pending = new Map<
    string,
    {
      reject: (error: StreamMessagesTransportError) => void;
      resolve: (rawFrame: string) => void;
      removeAbortListener: () => void;
    }
  >();
  readonly #applicationListeners = new Map<string, Set<(rawPayload: string) => void>>();
  readonly #applicationSocketEventNames = new Set<string>();
  #connectionAttempt = 0;
  #connectPromise: Promise<void> | undefined;
  #explicitlyClosed = false;
  #lifecycleAbortController = new AbortController();
  #serverConnectionGeneration: string | undefined;
  #socket: RealtimeEventSocket | undefined;
  #socketUnsubscribers: Array<() => void> = [];
  #state: AuthenticatedStreamMessagesRealtimeSession["state"] = "closed";

  constructor(options: AuthenticatedRealtimeSessionModelOptions) {
    super();
    this.options = options;
    assertNonBlank(options.actorSessionNamespace, "actorSessionNamespace");
    this.#connectedTimeoutMilliseconds = parsePositiveInteger(
      options.connectedTimeoutMilliseconds,
      DEFAULT_GATEWAY_CONNECTED_TIMEOUT_MS,
      "connectedTimeoutMilliseconds",
    );
    this.#maxImmediateRetries = parseNonNegativeInteger(
      options.maxImmediateRetries,
      DEFAULT_REALTIME_MAX_IMMEDIATE_RETRIES,
      "maxImmediateRetries",
    );
    this.#reconnectBaseDelayMilliseconds = parsePositiveInteger(
      options.reconnectBaseDelayMilliseconds,
      DEFAULT_REALTIME_RECONNECT_BASE_DELAY_MS,
      "reconnectBaseDelayMilliseconds",
    );
    this.#reconnectMaxDelayMilliseconds = parsePositiveInteger(
      options.reconnectMaxDelayMilliseconds,
      DEFAULT_REALTIME_RECONNECT_MAX_DELAY_MS,
      "reconnectMaxDelayMilliseconds",
    );

    if (this.#reconnectBaseDelayMilliseconds > this.#reconnectMaxDelayMilliseconds) {
      throw new TypeError("reconnect base delay는 max delay보다 클 수 없습니다.");
    }

    this.#delay = options.delay ?? delayWithAbort;
  }

  get state(): AuthenticatedStreamMessagesRealtimeSession["state"] {
    return this.#state;
  }

  get connectionGeneration(): string | undefined {
    return this.#serverConnectionGeneration;
  }

  connect(): Promise<void> {
    if (this.#state === "ready") {
      return Promise.resolve();
    }

    if (this.#connectPromise !== undefined) {
      return this.#connectPromise;
    }

    if (this.#explicitlyClosed) {
      this.#explicitlyClosed = false;
      this.#lifecycleAbortController = new AbortController();
    }

    this.#setState("connecting");
    const active = this.#connectWithRetries(this.#lifecycleAbortController.signal).finally(() => {
      if (this.#connectPromise === active) {
        this.#connectPromise = undefined;
      }
    });
    this.#connectPromise = active;
    return active;
  }

  requestStreamSync(input: ChatStreamSyncEvent, context: { signal: AbortSignal }): Promise<string> {
    const event = ChatStreamSyncEventSchema.parse(input);
    const socket = this.#socket;

    if (this.#state !== "ready" || socket === undefined) {
      return Promise.reject(
        new StreamMessagesTransportError(
          this.#state === "closed" ? "socket_closed" : "session_not_ready",
        ),
      );
    }

    if (this.#pending.has(event.requestId)) {
      return Promise.reject(new StreamMessagesTransportError("protocol_failure"));
    }

    if (context.signal.aborted) {
      return Promise.reject(new StreamMessagesTransportError("cancelled"));
    }

    return new Promise((resolve, reject) => {
      const handleAbort = () => {
        this.#settlePending(event.requestId);
        reject(new StreamMessagesTransportError("cancelled"));
      };
      context.signal.addEventListener("abort", handleAbort, { once: true });
      this.#pending.set(event.requestId, {
        reject,
        resolve,
        removeAbortListener: () => context.signal.removeEventListener("abort", handleAbort),
      });

      try {
        socket.emit("chat.stream.sync", JSON.stringify(event));
      } catch {
        this.#settlePending(event.requestId);
        reject(new StreamMessagesTransportError("socket_closed"));
      }
    });
  }

  sendApplicationEvent(eventName: string, rawPayload: string): void {
    const parsedEventName = parseEventName(eventName);
    const socket = this.#socket;

    if (this.#state !== "ready" || socket === undefined) {
      throw new StreamMessagesTransportError(
        this.#state === "closed" ? "socket_closed" : "session_not_ready",
      );
    }

    try {
      socket.emit(parsedEventName, rawPayload);
    } catch {
      throw new StreamMessagesTransportError("socket_closed");
    }
  }

  onApplicationEvent(eventName: string, listener: (rawPayload: string) => void): () => void {
    const parsedEventName = parseEventName(eventName);
    let listeners = this.#applicationListeners.get(parsedEventName);

    if (listeners === undefined) {
      listeners = new Set();
      this.#applicationListeners.set(parsedEventName, listeners);
    }

    listeners.add(listener);
    this.#ensureApplicationSocketSubscription(parsedEventName);

    return () => {
      const currentListeners = this.#applicationListeners.get(parsedEventName);
      currentListeners?.delete(listener);

      if (currentListeners?.size === 0) {
        this.#applicationListeners.delete(parsedEventName);
      }
    };
  }

  disconnect(): void {
    this.#explicitlyClosed = true;
    this.#lifecycleAbortController.abort();
    this.#cleanupSocket(true);
    this.#rejectAllPending(new StreamMessagesTransportError("cancelled"));
    this.#serverConnectionGeneration = undefined;
    this.#setState("closed");
  }

  async #connectWithRetries(signal: AbortSignal): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#maxImmediateRetries; attempt += 1) {
      assertNotAborted(signal);

      try {
        await this.#connectOnce(signal);
        return;
      } catch (error) {
        lastError = error;
        this.#cleanupSocket(true);

        if (
          signal.aborted ||
          attempt === this.#maxImmediateRetries ||
          (error instanceof StreamMessagesTransportError &&
            (error.code === "ticket_rejected" || error.code === "protocol_failure"))
        ) {
          break;
        }

        const delay = Math.min(
          this.#reconnectBaseDelayMilliseconds * 2 ** attempt,
          this.#reconnectMaxDelayMilliseconds,
        );
        await this.#delay(delay, signal);
      }
    }

    this.#setState("closed");
    throw lastError instanceof Error
      ? lastError
      : new StreamMessagesTransportError("socket_closed");
  }

  async #connectOnce(signal: AbortSignal): Promise<void> {
    const issued = IssueGatewayTicketResponseSchema.parse(await this.#issueTicket(signal));
    assertNotAborted(signal);
    this.#connectionAttempt += 1;
    const socket = this.options.createSocket({
      clientConnectionGeneration: String(this.#connectionAttempt),
      gatewayUrl: issued.gatewayUrl,
      ticket: issued.ticket,
    });
    this.#socket = socket;
    const connected = this.#waitForConnected(socket, signal);
    this.#attachFeatureListeners(socket);
    socket.connect();
    const connectedEvent = await connected;

    if (this.#socket !== socket) {
      throw new StreamMessagesTransportError("stale_response");
    }

    this.#serverConnectionGeneration = connectedEvent.connectionGeneration;
    this.#setState("ready");
  }

  async #issueTicket(parentSignal: AbortSignal): Promise<IssueGatewayTicketResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort(parentSignal.reason);

    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#connectedTimeoutMilliseconds);

    try {
      return await raceWithAbort(
        this.options.ticketIssuer.issue({ signal: controller.signal }),
        controller.signal,
      );
    } catch (error) {
      if (parentSignal.aborted) {
        throw new StreamMessagesTransportError("cancelled");
      }

      if (timedOut) {
        throw new StreamMessagesTransportError("timeout");
      }

      throw error;
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abortFromParent);
    }
  }

  #waitForConnected(
    socket: RealtimeEventSocket,
    signal: AbortSignal,
  ): Promise<{ connectionGeneration: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", handleAbort);
        unsubscribeConnected();
        unsubscribeClose();
        callback();
      };
      const handleAbort = () => finish(() => reject(new StreamMessagesTransportError("cancelled")));
      const unsubscribeConnected = socket.on("gateway.connected", (rawPayload) => {
        if (this.#socket !== socket) return;

        let value: unknown;

        try {
          value = JSON.parse(rawPayload) as unknown;
        } catch {
          finish(() => reject(new StreamMessagesTransportError("protocol_failure")));
          return;
        }

        const parsed = GatewayConnectedEventSchema.safeParse(value);

        if (!parsed.success) {
          finish(() => reject(new StreamMessagesTransportError("protocol_failure")));
          return;
        }

        finish(() => resolve({ connectionGeneration: parsed.data.connectionGeneration }));
      });
      const unsubscribeClose = socket.onClose(() => {
        finish(() => reject(new StreamMessagesTransportError("socket_closed")));
      });
      const timer = setTimeout(
        () => finish(() => reject(new StreamMessagesTransportError("timeout"))),
        this.#connectedTimeoutMilliseconds,
      );
      signal.addEventListener("abort", handleAbort, { once: true });
    });
  }

  #attachFeatureListeners(socket: RealtimeEventSocket): void {
    for (const eventName of [
      "chat.stream.synced",
      "chat.stream.sync.rejected",
      "chat.stream.sync.failed",
    ] as const) {
      this.#socketUnsubscribers.push(
        socket.on(eventName, (rawPayload) => {
          if (this.#socket !== socket) return;
          const requestId = readRequestId(rawPayload);

          if (requestId === null) return;
          const pending = this.#settlePending(requestId);
          pending?.resolve(rawPayload);
        }),
      );
    }

    this.#socketUnsubscribers.push(
      socket.onClose(() => {
        if (this.#socket !== socket) return;
        this.#cleanupSocket(false);
        this.#serverConnectionGeneration = undefined;
        this.#rejectAllPending(new StreamMessagesTransportError("socket_closed"));

        if (this.#explicitlyClosed) {
          this.#setState("closed");
          return;
        }

        this.#setState("connecting");
        queueMicrotask(() => {
          if (!this.#explicitlyClosed && this.#socket === undefined) {
            void this.connect().catch(() => undefined);
          }
        });
      }),
    );

    for (const eventName of this.#applicationListeners.keys()) {
      this.#ensureApplicationSocketSubscription(eventName, socket);
    }
  }

  #ensureApplicationSocketSubscription(eventName: string, socket = this.#socket): void {
    if (socket === undefined || this.#applicationSocketEventNames.has(eventName)) {
      return;
    }

    this.#applicationSocketEventNames.add(eventName);
    this.#socketUnsubscribers.push(
      socket.on(eventName, (rawPayload) => {
        if (this.#socket !== socket) {
          return;
        }

        for (const listener of this.#applicationListeners.get(eventName) ?? []) {
          listener(rawPayload);
        }
      }),
    );
  }

  #settlePending(requestId: string) {
    const pending = this.#pending.get(requestId);

    if (pending !== undefined) {
      pending.removeAbortListener();
      this.#pending.delete(requestId);
    }

    return pending;
  }

  #rejectAllPending(error: StreamMessagesTransportError): void {
    for (const requestId of [...this.#pending.keys()]) {
      this.#settlePending(requestId)?.reject(error);
    }
  }

  #cleanupSocket(close: boolean): void {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#applicationSocketEventNames.clear();

    for (const unsubscribe of this.#socketUnsubscribers.splice(0)) {
      unsubscribe();
    }

    if (close) {
      socket?.close();
    }
  }

  #setState(state: AuthenticatedStreamMessagesRealtimeSession["state"]): void {
    if (this.#state === state) return;
    this.#state = state;
    this.emit();
  }
}

export type CreateGatewayTicketHttpIssuerOptions = {
  apiBaseUrl: string | URL;
  fetch?: typeof globalThis.fetch;
};

export function createGatewayTicketHttpIssuer(
  options: CreateGatewayTicketHttpIssuerOptions,
): GatewayTicketIssuer {
  const apiBaseUrl = new URL(options.apiBaseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  if (apiBaseUrl.protocol !== "http:" && apiBaseUrl.protocol !== "https:") {
    throw new TypeError("Gateway ticket API base URL은 HTTP(S)여야 합니다.");
  }

  if (!apiBaseUrl.pathname.endsWith("/")) {
    apiBaseUrl.pathname += "/";
  }

  if (typeof fetchImplementation !== "function") {
    throw new TypeError("Gateway ticket issuer에 fetch 구현이 필요합니다.");
  }

  return {
    async issue({ signal }) {
      let response: Response;

      try {
        response = await fetchImplementation(new URL("realtime-chat/gateway-tickets", apiBaseUrl), {
          body: "{}",
          credentials: "include",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          method: "POST",
          signal,
        });
      } catch {
        throw new StreamMessagesTransportError(
          signal.aborted ? "cancelled" : "stream_messages_unavailable",
        );
      }

      let value: unknown;

      try {
        value = JSON.parse(await response.text()) as unknown;
      } catch {
        throw new StreamMessagesTransportError("protocol_failure");
      }

      if (!response.ok) {
        throw new StreamMessagesTransportError(
          response.status >= 500 ? "stream_messages_unavailable" : "ticket_rejected",
        );
      }

      const parsed = IssueGatewayTicketResponseSchema.safeParse(value);

      if (!parsed.success) {
        throw new StreamMessagesTransportError("protocol_failure");
      }

      return parsed.data;
    },
  };
}

const realtimeSessions = new Map<string, AuthenticatedRealtimeSessionModel>();

export function getAuthenticatedRealtimeSession(
  options: AuthenticatedRealtimeSessionModelOptions,
): AuthenticatedRealtimeSessionModel {
  const key = options.actorSessionNamespace;
  let session = realtimeSessions.get(key);

  if (session === undefined) {
    session = new AuthenticatedRealtimeSessionModel(options);
    realtimeSessions.set(key, session);
  }

  return session;
}

export function disposeAuthenticatedRealtimeSession(actorSessionNamespace: string): void {
  const session = realtimeSessions.get(actorSessionNamespace);
  session?.disconnect();
  realtimeSessions.delete(actorSessionNamespace);
}

function readRequestId(rawPayload: string): string | null {
  let value: unknown;

  try {
    value = JSON.parse(rawPayload) as unknown;
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const parsed = RequestIdSchema.safeParse((value as Record<string, unknown>).requestId);
  return parsed.success ? parsed.data : null;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new StreamMessagesTransportError("cancelled");
  }
}

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`${label}은 공백 없는 문자열이어야 합니다.`);
  }
}

function parseEventName(value: string): string {
  const parsed = value.trim();

  if (parsed.length === 0 || parsed !== value) {
    throw new TypeError("realtime application event name은 공백 없는 문자열이어야 합니다.");
  }

  return parsed;
}

function parsePositiveInteger(value: number | undefined, fallback: number, label: string): number {
  const parsed = value ?? fallback;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label}은 양의 safe integer여야 합니다.`);
  }

  return parsed;
}

function parseNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const parsed = value ?? fallback;

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label}은 0 이상의 safe integer여야 합니다.`);
  }

  return parsed;
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

function raceWithAbort<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) {
    return Promise.reject(new StreamMessagesTransportError("cancelled"));
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(new StreamMessagesTransportError("cancelled"));
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}
