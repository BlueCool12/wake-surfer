import type { RealtimeChatMessageTransport } from "./message-transport.js";
import type { StreamMessagesClientTarget } from "./target.js";
import type { StreamMessagesTransport } from "./transport.js";

export type RealtimeChatTargetRuntime = {
  messageTransport: RealtimeChatMessageTransport;
  streamMessagesTransport: StreamMessagesTransport;
};

export type RealtimeChatTargetRuntimeContext = {
  actorId: string;
  target: StreamMessagesClientTarget;
};

export type RealtimeChatTargetRuntimeFactory = (
  context: RealtimeChatTargetRuntimeContext,
) => RealtimeChatTargetRuntime;
