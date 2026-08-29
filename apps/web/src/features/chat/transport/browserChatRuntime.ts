import {
  createBrowserRealtimeChatTargetRuntimeFactory,
  RealtimeChatTargetSessionRegistry,
  type KeyValueStorage,
  type RealtimeChatTargetSession,
  type StreamMessagesClientTarget,
} from "@wake-surfer/realtime-chat-stream-messages-client";

const DEFAULT_ACTOR_ID = "user-me";

let configuredActorId: string | undefined;
let configuredSessionRegistry: RealtimeChatTargetSessionRegistry | undefined;

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
  configuredSessionRegistry?.dispose();
  configuredSessionRegistry = new RealtimeChatTargetSessionRegistry({
    runtimeFactory: createBrowserRealtimeChatTargetRuntimeFactory({
      apiBaseUrl: options.apiBaseUrl,
      ...(options.actorHeader === undefined ? {} : { actorHeader: options.actorHeader }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
  });
}

export function getConfiguredChatActorId(): string {
  if (configuredActorId === undefined) {
    throw new Error("브라우저 채팅 runtime이 아직 설정되지 않았습니다.");
  }

  return configuredActorId;
}

export function getConfiguredChatSession(input: {
  actorId: string;
  target: StreamMessagesClientTarget;
  storage: KeyValueStorage;
}): RealtimeChatTargetSession {
  if (configuredSessionRegistry === undefined) {
    throw new Error("브라우저 채팅 runtime이 아직 설정되지 않았습니다.");
  }

  return configuredSessionRegistry.getSession(input);
}

export function resolveBrowserChatActorId(location: Pick<Location, "search">): string {
  const actorId = new URLSearchParams(location.search).get("actor")?.trim();
  return actorId || DEFAULT_ACTOR_ID;
}

function parseNonBlank(value: string, label: string): string {
  const parsed = value.trim();

  if (parsed.length === 0 || parsed !== value) {
    throw new TypeError(`${label}은 공백 없는 문자열이어야 합니다.`);
  }

  return parsed;
}
