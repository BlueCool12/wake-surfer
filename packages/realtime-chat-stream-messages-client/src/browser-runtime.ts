import {
  createGatewayTicketHttpIssuer,
  getAuthenticatedRealtimeSession,
} from "./authenticated-realtime-session.js";
import { createBrowserRealtimeChatMessageTransport } from "./browser-message-transport.js";
import { createBrowserRealtimeEventSocket } from "./browser-realtime-event-socket.js";
import { createBrowserStreamMessagesTransport } from "./browser-transport.js";

import type { RealtimeChatTargetRuntimeFactory } from "./runtime.js";

const DEFAULT_ACTOR_HEADER = "x-actor-id";

export function createBrowserRealtimeChatTargetRuntimeFactory(options: {
  actorHeader?: string;
  apiBaseUrl: string | URL;
  fetch?: typeof globalThis.fetch;
}): RealtimeChatTargetRuntimeFactory {
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
      messageTransport: createBrowserRealtimeChatMessageTransport({
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
