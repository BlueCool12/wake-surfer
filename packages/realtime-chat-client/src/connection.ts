import { GatewayConnectedEventSchema } from "@wake-surfer/realtime-chat-gateway-ticket-contracts";
import { MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES } from "@wake-surfer/realtime-chat-stream-messages-contracts";
import { abortError, assertActive, clientError } from "./errors.js";
import { notify } from "./notifications.js";
import { RealtimeChatClientError } from "./realtime-chat-client-error.js";
import { abortable, retry, withTimeout } from "./operations.js";
import { parse, parseJson, record } from "./protocol.js";
import type { ChatApi } from "./api.js";
import type { ConnectionState } from "./types.js";

const RECONNECT = { maxAttempts: 3, baseDelayMilliseconds: 3_000, maxDelayMilliseconds: 3_000 };

/** 인스턴스 하나의 연결과 응답 대기만 소유한다. 메시지 데이터는 보관하지 않는다. */
export class ChatConnection {
  readonly #lifetime: AbortSignal;
  readonly #states = new Set<(state: ConnectionState) => void>();
  readonly #events = new Set<(event: string, payload: unknown) => void>();
  readonly #pending = new Set<{
    receive: (event: string, payload: unknown) => void;
    reject: (error: RealtimeChatClientError) => void;
  }>();
  #socket: WebSocket | undefined;
  #connecting: Promise<void> | undefined;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #state: ConnectionState = "closed";
  #closed = false;

  constructor(
    readonly http: ChatApi,
    lifetime: AbortSignal,
  ) { this.#lifetime = lifetime; }
  get state(): ConnectionState {
    return this.#state;
  }
  onState(listener: (state: ConnectionState) => void): () => void {
    this.#states.add(listener);
    return () => {
      this.#states.delete(listener);
    };
  }
  onEvent(listener: (event: string, payload: unknown) => void): () => void {
    this.#events.add(listener);
    return () => {
      this.#events.delete(listener);
    };
  }

  async connect(): Promise<void> {
    assertActive(this.#lifetime);
    if (this.#state === "ready") return;
    if (this.#connecting !== undefined) return this.#connecting;
    this.#setState("connecting");
    const active = retry(() => this.#connectOnce(), this.#lifetime, RECONNECT)
      .catch((error: unknown) => {
        this.#setState("closed");
        throw error;
      })
      .finally(() => {
        if (this.#connecting === active) this.#connecting = undefined;
      });
    this.#connecting = active;
    return active;
  }

  async ensureReady(signal: AbortSignal): Promise<void> {
    assertActive(signal);
    await abortable(this.connect(), signal);
    assertActive(signal);
  }

  send(event: string, payload: object): void {
    if (this.#state !== "ready" || this.#socket?.readyState !== 1) {
      throw new RealtimeChatClientError("socket_closed");
    }
    try {
      this.#socket.send(JSON.stringify({ type: event, ...payload }));
    } catch (cause) {
      const error = new RealtimeChatClientError("socket_closed", { cause });
      this.#discard(this.#socket, error, true);
      throw error;
    }
  }

  request<T>(
    event: string,
    payload: object,
    decode: (event: string, payload: unknown) => T | undefined,
    parent: AbortSignal,
    isolateOnFailure = false,
  ): Promise<T> {
    return withTimeout(
      parent,
      this.http.timeout,
      (signal) =>
        new Promise<T>((resolve, reject) => {
          assertActive(signal);
          const socket = this.#socket;
          if (socket === undefined || this.#state !== "ready") {
            reject(new RealtimeChatClientError("socket_closed"));
            return;
          }
          let settled = false;
          const finish = (result: { value: T } | { error: RealtimeChatClientError }) => {
            if (settled) return;
            settled = true;
            this.#pending.delete(pending);
            signal.removeEventListener("abort", onAbort);
            if ("error" in result) {
              reject(result.error);
              // 요청 식별자가 없는 수정·삭제의 늦은 응답은 연결을 바꿔 격리한다.
              if (isolateOnFailure) this.#discard(socket, result.error, true);
            } else resolve(result.value);
          };
          const onAbort = () => finish({ error: abortError(signal) });
          const pending = {
            reject: (error: RealtimeChatClientError) => finish({ error }),
            receive: (name: string, data: unknown) => {
              try {
                const value = decode(name, data);
                if (value !== undefined) finish({ value });
              } catch (error) {
                finish({ error: clientError(error) });
              }
            },
          };
          this.#pending.add(pending);
          signal.addEventListener("abort", onAbort, { once: true });
          try {
            this.send(event, payload);
          } catch (error) {
            finish({ error: clientError(error) });
          }
        }),
    );
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const error = new RealtimeChatClientError("client_closed");
    if (this.#socket !== undefined) this.#discard(this.#socket, error, false);
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#setState("closed");
    this.#events.clear();
    this.#states.clear();
  }

  async #connectOnce(): Promise<void> {
    const signal = this.#lifetime;
    const ticket = await this.http.issueTicket(signal);
    assertActive(signal);
    const url = new URL(ticket.gatewayUrl);
    if (!["ws:", "wss:"].includes(url.protocol))
      throw new RealtimeChatClientError("protocol_failure");
    url.searchParams.set("ticket", ticket.ticket);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (cause) {
      throw new RealtimeChatClientError("socket_closed", { cause });
    }
    this.#socket = socket;
    try {
      await withTimeout(
        signal,
        this.http.timeout,
        (scope) =>
          new Promise<void>((resolve, reject) => {
            let ready = false;
            const onAbort = () => reject(abortError(scope));
            scope.addEventListener("abort", onAbort, { once: true });
            const fail = (error: RealtimeChatClientError) => {
              scope.removeEventListener("abort", onAbort);
              reject(error);
              this.#discard(socket, error, ready);
            };
            socket.onclose = () => fail(new RealtimeChatClientError("socket_closed"));
            socket.onerror = () => fail(new RealtimeChatClientError("socket_closed"));
            socket.onmessage = ({ data }: MessageEvent<unknown>) => {
              if (this.#socket !== socket) return;
              let frame: Record<string, unknown>;
              try {
                if (
                  typeof data !== "string" ||
                  new TextEncoder().encode(data).byteLength >
                    MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES
                ) {
                  throw new RealtimeChatClientError("protocol_failure");
                }
                const parsed = parseJson(data);
                if (
                  !record(parsed) ||
                  typeof parsed.type !== "string" ||
                  !parsed.type ||
                  parsed.type.trim() !== parsed.type
                ) {
                  throw new RealtimeChatClientError("protocol_failure");
                }
                frame = parsed;
              } catch (error) {
                fail(clientError(error));
                return;
              }
              const { type, ...payload } = frame;
              if (!ready) {
                if (type !== "gateway.connected") return;
                try {
                  parse(GatewayConnectedEventSchema, payload);
                } catch (error) {
                  fail(clientError(error));
                  return;
                }
                ready = true;
                scope.removeEventListener("abort", onAbort);
                this.#setState("ready");
                resolve();
                return;
              }
              for (const pending of this.#pending) pending.receive(type as string, payload);
              for (const listener of [...this.#events])
                notify(() => listener(type as string, payload));
            };
          }),
      );
    } catch (error) {
      this.#discard(socket, clientError(error), false);
      throw error;
    }
  }

  #discard(socket: WebSocket, error: RealtimeChatClientError, reconnect: boolean): void {
    if (this.#socket !== socket) return;
    this.#socket = undefined;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    for (const request of this.#pending) request.reject(error);
    if (!reconnect || this.#lifetime.aborted || this.#closed) return;
    this.#setState("connecting");
    if (this.#reconnectTimer !== undefined) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (!this.#lifetime.aborted && !this.#closed && this.#socket === undefined) {
        void this.connect().catch(() => undefined);
      }
    }, RECONNECT.baseDelayMilliseconds);
  }

  #setState(state: ConnectionState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of [...this.#states]) notify(() => listener(state));
  }
}
