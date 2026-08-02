import { ChatMessageSchema, type ChatMessage } from "@wake-surfer/realtime-chat-message-contracts";
import { SendMessageResponseSchema } from "@wake-surfer/realtime-chat-message-send-contracts";
import {
  createBrowserRealtimeEventSocket,
  createBrowserStreamMessagesTransport,
  createGatewayTicketHttpIssuer,
  getAuthenticatedRealtimeSession,
  type AuthenticatedRealtimeSessionModel,
} from "@wake-surfer/realtime-chat-stream-messages-client";

import { configureChatRoomRuntimeFactory } from "../chatRoomRegistry";

import type {
  ChatMessageTransport,
  ChatRoomRuntimeFactory,
  MessageAcceptedResponse,
  MessageRejectedResponse,
} from "./chatTransport";

const DEFAULT_ACTOR_ID = "user-me";
const DEFAULT_ACTOR_HEADER = "x-actor-id";
const CHAT_CHANNEL_JOIN_EVENT = "chat.channel.join";
const CHAT_MESSAGE_SEND_EVENT = "chat.message.send";
const CHAT_MESSAGE_ACCEPTED_EVENT = "chat.message.accepted";
const CHAT_MESSAGE_REJECTED_EVENT = "chat.message.rejected";
const CHAT_MESSAGE_CREATED_EVENT = "chat.message.created";

let configuredActorId: string | undefined;

export type ConfigureBrowserChatRuntimeOptions = {
  actorId?: string;
  actorHeader?: string;
  apiBaseUrl: string | URL;
  fetch?: typeof globalThis.fetch;
  location?: Pick<Location, "search">;
};

export function configureBrowserChatRuntime(options: ConfigureBrowserChatRuntimeOptions): void {
  const actorId = parseNonBlank(
    options.actorId ?? resolveBrowserChatActorId(options.location ?? window.location),
    "actorId",
  );
  configuredActorId = actorId;
  configureChatRoomRuntimeFactory(
    createBrowserChatRoomRuntimeFactory({
      apiBaseUrl: options.apiBaseUrl,
      ...(options.actorHeader === undefined ? {} : { actorHeader: options.actorHeader }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
  );
}

export function getConfiguredChatActorId(): string {
  if (configuredActorId === undefined) {
    throw new Error("브라우저 채팅 runtime이 아직 설정되지 않았습니다.");
  }

  return configuredActorId;
}

export function resolveBrowserChatActorId(location: Pick<Location, "search">): string {
  const actorId = new URLSearchParams(location.search).get("actor")?.trim();
  return actorId || DEFAULT_ACTOR_ID;
}

export function createBrowserChatRoomRuntimeFactory(options: {
  actorHeader?: string;
  apiBaseUrl: string | URL;
  fetch?: typeof globalThis.fetch;
}): ChatRoomRuntimeFactory {
  const apiBaseUrl = new URL(options.apiBaseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const actorHeader = parseNonBlank(options.actorHeader ?? DEFAULT_ACTOR_HEADER, "actorHeader");

  if (typeof fetchImplementation !== "function") {
    throw new TypeError("브라우저 채팅 runtime에 fetch 구현이 필요합니다.");
  }

  return ({ actorId, channelId }) => {
    const actorFetch = createActorAuthenticatedFetch({
      actorHeader,
      actorId,
      fetch: fetchImplementation,
    });
    const realtimeSession = getAuthenticatedRealtimeSession({
      actorSessionNamespace: createActorSessionNamespace(apiBaseUrl, actorId),
      createSocket: createBrowserRealtimeEventSocket,
      ticketIssuer: createGatewayTicketHttpIssuer({
        apiBaseUrl,
        fetch: actorFetch,
      }),
    });

    return {
      messageTransport: createBrowserChatMessageTransport({
        channelId,
        realtimeSession,
      }),
      streamMessagesTransport: createBrowserStreamMessagesTransport({
        apiBaseUrl,
        fetch: actorFetch,
        realtimeSession,
      }),
    };
  };
}

export function createActorAuthenticatedFetch(options: {
  actorHeader?: string;
  actorId: string;
  fetch?: typeof globalThis.fetch;
}): typeof globalThis.fetch {
  const actorId = parseNonBlank(options.actorId, "actorId");
  const actorHeader = parseNonBlank(options.actorHeader ?? DEFAULT_ACTOR_HEADER, "actorHeader");
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new TypeError("actor 인증 fetch 구현이 필요합니다.");
  }

  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set(actorHeader, actorId);
    return fetchImplementation(input, {
      ...init,
      headers,
    });
  };
}

export type ChatApplicationRealtimeSession = Pick<
  AuthenticatedRealtimeSessionModel,
  | "connect"
  | "connectionGeneration"
  | "onApplicationEvent"
  | "sendApplicationEvent"
  | "state"
  | "subscribe"
>;

export function createBrowserChatMessageTransport(options: {
  channelId: string;
  realtimeSession: ChatApplicationRealtimeSession;
}): ChatMessageTransport {
  const channelId = parseNonBlank(options.channelId, "channelId");
  const connectionGenerationListeners = new Set<(connectionGeneration: string) => void>();
  const disconnectedListeners = new Set<() => void>();
  let disconnectionNotified = false;
  let lastJoinedConnectionGeneration: string | undefined;
  let lastNotifiedConnectionGeneration: string | undefined;
  const handleCurrentGeneration = () => {
    const generation = options.realtimeSession.connectionGeneration;

    if (options.realtimeSession.state !== "ready" || generation === undefined) {
      if (lastNotifiedConnectionGeneration !== undefined && !disconnectionNotified) {
        disconnectionNotified = true;

        for (const listener of disconnectedListeners) {
          listener();
        }
      }

      return;
    }

    disconnectionNotified = false;

    if (generation !== lastJoinedConnectionGeneration) {
      options.realtimeSession.sendApplicationEvent(
        CHAT_CHANNEL_JOIN_EVENT,
        JSON.stringify({ channelId }),
      );
      lastJoinedConnectionGeneration = generation;
    }

    if (generation !== lastNotifiedConnectionGeneration) {
      lastNotifiedConnectionGeneration = generation;

      for (const listener of connectionGenerationListeners) {
        listener(generation);
      }
    }
  };
  const unsubscribeConnection = options.realtimeSession.subscribe(handleCurrentGeneration);

  return {
    async connect() {
      await options.realtimeSession.connect();
      handleCurrentGeneration();
    },
    disconnect() {
      unsubscribeConnection();
      connectionGenerationListeners.clear();
      disconnectedListeners.clear();
    },
    isReady() {
      return options.realtimeSession.state === "ready";
    },
    sendChannelMessage({ idempotencyKey, text }) {
      options.realtimeSession.sendApplicationEvent(
        CHAT_MESSAGE_SEND_EVENT,
        JSON.stringify({
          idempotencyKey,
          target: { type: "channel", channelId },
          text,
        }),
      );
    },
    onConnectionGenerationChanged(listener) {
      connectionGenerationListeners.add(listener);
      handleCurrentGeneration();
      return () => connectionGenerationListeners.delete(listener);
    },
    onDisconnected(listener) {
      disconnectedListeners.add(listener);
      return () => disconnectedListeners.delete(listener);
    },
    onMessageAccepted(listener) {
      return options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_ACCEPTED_EVENT,
        (rawPayload) => {
          const response = parseAcceptedResponse(rawPayload);

          if (
            response !== null &&
            response.message.target.type === "channel" &&
            response.message.target.channelId === channelId
          ) {
            listener(response);
          }
        },
      );
    },
    onMessageRejected(listener) {
      return options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_REJECTED_EVENT,
        (rawPayload) => {
          const response = parseRejectedResponse(rawPayload);

          if (response !== null) {
            listener(response);
          }
        },
      );
    },
    onMessageCreated(listener) {
      return options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_CREATED_EVENT,
        (rawPayload) => {
          const message = parseChatMessage(rawPayload);

          if (
            message !== null &&
            message.target.type === "channel" &&
            message.target.channelId === channelId
          ) {
            listener(message);
          }
        },
      );
    },
  };
}

function parseAcceptedResponse(rawPayload: string): MessageAcceptedResponse | null {
  const value = parseJson(rawPayload);

  if (value === null) {
    return null;
  }

  const parsed = SendMessageResponseSchema.safeParse(value);

  if (!parsed.success || parsed.data.status !== "accepted") {
    return null;
  }

  return parsed.data;
}

function parseRejectedResponse(rawPayload: string): MessageRejectedResponse | null {
  const value = parseJson(rawPayload);

  if (value === null) {
    return null;
  }

  const parsed = SendMessageResponseSchema.safeParse(value);

  if (!parsed.success || parsed.data.status !== "rejected") {
    return null;
  }

  return parsed.data;
}

function parseChatMessage(rawPayload: string): ChatMessage | null {
  const value = parseJson(rawPayload);

  if (value === null) {
    return null;
  }

  const parsed = ChatMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseJson(rawPayload: string): unknown | null {
  try {
    return JSON.parse(rawPayload) as unknown;
  } catch {
    return null;
  }
}

function createActorSessionNamespace(apiBaseUrl: URL, actorId: string): string {
  return `realtime-chat:${apiBaseUrl.origin}${apiBaseUrl.pathname}:${encodeURIComponent(actorId)}`;
}

function parseNonBlank(value: string, label: string): string {
  const parsed = value.trim();

  if (parsed.length === 0 || parsed !== value) {
    throw new TypeError(`${label}은 공백 없는 문자열이어야 합니다.`);
  }

  return parsed;
}
