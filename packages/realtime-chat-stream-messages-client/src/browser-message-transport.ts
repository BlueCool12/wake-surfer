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

import type { AuthenticatedRealtimeSessionModel } from "./authenticated-realtime-session.js";
import type {
  RealtimeChatMessageAcceptedResponse,
  RealtimeChatMessageRejectedResponse,
  RealtimeChatMessageTransport,
} from "./message-transport.js";
import { streamMessagesClientTargetsEqual, type StreamMessagesClientTarget } from "./target.js";

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

export type RealtimeChatApplicationSession = Pick<
  AuthenticatedRealtimeSessionModel,
  | "connect"
  | "connectionGeneration"
  | "onApplicationEvent"
  | "sendApplicationEvent"
  | "state"
  | "subscribe"
>;

export function createBrowserRealtimeChatMessageTransport(options: {
  realtimeSession: RealtimeChatApplicationSession;
  target: StreamMessagesClientTarget;
}): RealtimeChatMessageTransport {
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

function parseAcceptedResponse(rawPayload: string): RealtimeChatMessageAcceptedResponse | null {
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

function parseRejectedResponse(rawPayload: string): RealtimeChatMessageRejectedResponse | null {
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
