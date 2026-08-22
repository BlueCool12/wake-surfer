import {
  PublicMessageSchema,
  type PublicMessage,
} from "@wake-surfer/realtime-chat-message-contracts";
import {
  DeleteMessageResponseSchema,
  EditMessageResponseSchema,
  type DeleteMessageResponse,
  type EditMessageResponse,
} from "@wake-surfer/realtime-chat-message-mutation-contracts";
import { SendMessageResponseSchema } from "@wake-surfer/realtime-chat-message-send-contracts";
import {
  createBrowserRealtimeEventSocket,
  createBrowserStreamMessagesTransport,
  createGatewayTicketHttpIssuer,
  getAuthenticatedRealtimeSession,
  streamMessagesClientTargetsEqual,
  type AuthenticatedRealtimeSessionModel,
  type StreamMessagesClientTarget,
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
const CHAT_MESSAGE_EDIT_EVENT = "chat.message.edit";
const CHAT_MESSAGE_EDIT_ACCEPTED_EVENT = "chat.message.edit.accepted";
const CHAT_MESSAGE_EDIT_REJECTED_EVENT = "chat.message.edit.rejected";
const CHAT_MESSAGE_DELETE_EVENT = "chat.message.delete";
const CHAT_MESSAGE_DELETE_ACCEPTED_EVENT = "chat.message.delete.accepted";
const CHAT_MESSAGE_DELETE_REJECTED_EVENT = "chat.message.delete.rejected";

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

  return ({ actorId, target }) => {
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
        realtimeSession,
        target,
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
  realtimeSession: ChatApplicationRealtimeSession;
  target: StreamMessagesClientTarget;
}): ChatMessageTransport {
  const target = options.target;
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

    if (target.type === "channel" && generation !== lastJoinedConnectionGeneration) {
      options.realtimeSession.sendApplicationEvent(
        CHAT_CHANNEL_JOIN_EVENT,
        JSON.stringify({ channelId: target.channelId }),
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
    deleteMessage({ messageId }) {
      options.realtimeSession.sendApplicationEvent(
        CHAT_MESSAGE_DELETE_EVENT,
        JSON.stringify({ messageId }),
      );
    },
    disconnect() {
      unsubscribeConnection();
      connectionGenerationListeners.clear();
      disconnectedListeners.clear();
    },
    editMessage({ messageId, text }) {
      options.realtimeSession.sendApplicationEvent(
        CHAT_MESSAGE_EDIT_EVENT,
        JSON.stringify({ messageId, text }),
      );
    },
    isReady() {
      return options.realtimeSession.state === "ready";
    },
    sendMessage({ idempotencyKey, text }) {
      options.realtimeSession.sendApplicationEvent(
        CHAT_MESSAGE_SEND_EVENT,
        JSON.stringify({
          idempotencyKey,
          target,
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
            streamMessagesClientTargetsEqual(target, response.message.target)
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
    onMessageDeleteResult(listener) {
      const unsubscribeAccepted = options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_DELETE_ACCEPTED_EVENT,
        (rawPayload) => {
          const response = parseDeleteMessageResponse(rawPayload);

          if (
            response?.status === "accepted" &&
            streamMessagesClientTargetsEqual(target, response.message.target)
          ) {
            listener(response);
          }
        },
      );
      const unsubscribeRejected = options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_DELETE_REJECTED_EVENT,
        (rawPayload) => {
          const response = parseDeleteMessageResponse(rawPayload);

          if (response?.status === "rejected") {
            listener(response);
          }
        },
      );

      return () => {
        unsubscribeAccepted();
        unsubscribeRejected();
      };
    },
    onMessageEditResult(listener) {
      const handleResponse = (rawPayload: string) => {
        const response = parseEditMessageResponse(rawPayload);

        if (
          response !== null &&
          (response.status === "rejected" && response.reason !== "message_deleted"
            ? true
            : streamMessagesClientTargetsEqual(target, response.message.target))
        ) {
          listener(response);
        }
      };
      const unsubscribeAccepted = options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_EDIT_ACCEPTED_EVENT,
        handleResponse,
      );
      const unsubscribeRejected = options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_EDIT_REJECTED_EVENT,
        handleResponse,
      );

      return () => {
        unsubscribeAccepted();
        unsubscribeRejected();
      };
    },
    onMessageCreated(listener) {
      return options.realtimeSession.onApplicationEvent(
        CHAT_MESSAGE_CREATED_EVENT,
        (rawPayload) => {
          const message = parsePublicMessage(rawPayload);

          if (message !== null && streamMessagesClientTargetsEqual(target, message.target)) {
            listener(message);
          }
        },
      );
    },
  };
}

function parseEditMessageResponse(rawPayload: string): EditMessageResponse | null {
  const value = parseJson(rawPayload);
  const parsed = value === null ? undefined : EditMessageResponseSchema.safeParse(value);
  return parsed?.success === true ? parsed.data : null;
}

function parseDeleteMessageResponse(rawPayload: string): DeleteMessageResponse | null {
  const value = parseJson(rawPayload);
  const parsed = value === null ? undefined : DeleteMessageResponseSchema.safeParse(value);
  return parsed?.success === true ? parsed.data : null;
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

  const { text, ...message } = parsed.data.message;

  return {
    status: "accepted",
    idempotencyKey: parsed.data.idempotencyKey,
    message: {
      ...message,
      content: { type: "text", text },
    },
  };
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

function parsePublicMessage(rawPayload: string): PublicMessage | null {
  const value = parseJson(rawPayload);

  if (value === null) {
    return null;
  }

  const parsed = PublicMessageSchema.safeParse(value);
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
