import type {
  RealtimeEventSocket,
  RealtimeEventSocketFactory,
} from "./authenticated-realtime-session.js";

const WEB_SOCKET_OPEN = 1;

type BrowserWebSocketLike = {
  close: (code?: number, reason?: string) => void;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  readyState: number;
  send: (data: string) => void;
};

export type BrowserWebSocketFactory = (url: string) => BrowserWebSocketLike;

export type CreateBrowserRealtimeEventSocketOptions = Parameters<RealtimeEventSocketFactory>[0] & {
  createWebSocket?: BrowserWebSocketFactory;
};

export function createBrowserRealtimeEventSocket(
  options: CreateBrowserRealtimeEventSocketOptions,
): RealtimeEventSocket {
  return new BrowserRealtimeEventSocket(options);
}

export class BrowserRealtimeEventSocket implements RealtimeEventSocket {
  readonly #createWebSocket: BrowserWebSocketFactory;
  readonly #gatewayUrl: URL;
  readonly #listeners = new Map<string, Set<(rawPayload: string) => void>>();
  readonly #closeListeners = new Set<() => void>();
  readonly #ticket: string;
  #socket: BrowserWebSocketLike | undefined;

  constructor(options: CreateBrowserRealtimeEventSocketOptions) {
    this.#gatewayUrl = parseGatewayUrl(options.gatewayUrl);
    this.#ticket = parseNonBlank(options.ticket, "ticket");
    this.#createWebSocket = options.createWebSocket ?? createNativeWebSocket;
  }

  connect = (): void => {
    if (this.#socket !== undefined) {
      throw new TypeError("realtime WebSocket은 한 번만 connect할 수 있습니다.");
    }

    const url = new URL(this.#gatewayUrl);
    url.searchParams.set("ticket", this.#ticket);
    const socket = this.#createWebSocket(url.toString());
    this.#socket = socket;
    socket.onmessage = (event) => this.#handleMessage(event.data);
    socket.onclose = () => {
      if (this.#socket !== socket) {
        return;
      }

      for (const listener of [...this.#closeListeners]) {
        listener();
      }
    };
  };

  close = (): void => {
    this.#socket?.close(1000, "client closed");
  };

  emit = (eventName: string, rawPayload: string): void => {
    const socket = this.#socket;

    if (socket === undefined || socket.readyState !== WEB_SOCKET_OPEN) {
      throw new Error("realtime WebSocket이 열려 있지 않습니다.");
    }

    const payload = parsePayload(rawPayload);
    socket.send(
      JSON.stringify({
        type: parseNonBlank(eventName, "eventName"),
        ...payload,
      }),
    );
  };

  on = (eventName: string, listener: (rawPayload: string) => void): (() => void) => {
    const parsedEventName = parseNonBlank(eventName, "eventName");
    let listeners = this.#listeners.get(parsedEventName);

    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(parsedEventName, listeners);
    }

    listeners.add(listener);
    return () => {
      const currentListeners = this.#listeners.get(parsedEventName);
      currentListeners?.delete(listener);

      if (currentListeners?.size === 0) {
        this.#listeners.delete(parsedEventName);
      }
    };
  };

  onClose = (listener: () => void): (() => void) => {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  };

  #handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      this.#socket?.close(1003, "text JSON frames are required");
      return;
    }

    const frame = parseFrame(data);

    if (frame === null) {
      this.#socket?.close(1008, "invalid realtime event frame");
      return;
    }

    for (const listener of this.#listeners.get(frame.eventName) ?? []) {
      listener(frame.rawPayload);
    }
  }
}

function createNativeWebSocket(url: string): BrowserWebSocketLike {
  return new WebSocket(url) as unknown as BrowserWebSocketLike;
}

function parseGatewayUrl(value: string | URL): URL {
  const url = new URL(value);

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new TypeError("realtime gateway URL은 ws 또는 wss여야 합니다.");
  }

  return url;
}

function parsePayload(rawPayload: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(rawPayload) as unknown;
  } catch {
    throw new TypeError("realtime event payload는 JSON object여야 합니다.");
  }

  if (!isRecord(value) || Object.hasOwn(value, "type")) {
    throw new TypeError("realtime event payload는 top-level type이 없는 JSON object여야 합니다.");
  }

  return value;
}

function parseFrame(rawFrame: string): {
  eventName: string;
  rawPayload: string;
} | null {
  let value: unknown;

  try {
    value = JSON.parse(rawFrame) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  const eventName = value.type.trim();

  if (eventName.length === 0 || eventName !== value.type) {
    return null;
  }

  const { type: ignoredType, ...payload } = value;
  void ignoredType;
  return {
    eventName,
    rawPayload: JSON.stringify(payload),
  };
}

function parseNonBlank(value: string, label: string): string {
  const parsed = value.trim();

  if (parsed.length === 0 || parsed !== value) {
    throw new TypeError(`${label}은 공백 없는 문자열이어야 합니다.`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
