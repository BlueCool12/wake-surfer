import type {
  ConsumeGatewayTicketResponse,
  MarkReadCursorRequest,
  MessageCommandResponse,
  PostSessionStartedSystemMessageRequest,
  ReplyThreadMessageRequest,
  SendChannelMessageRequest,
  SendDMMessageRequest,
  SyncStreamMessagesRequest,
} from "@wake-surfer/realtime-chat-contracts";
import type { RealtimeChatApiMountOptions } from "../http/mount";
import type { RealtimeChatApiRuntimeDeps } from "../runtime-deps";
import {
  createConsumeGatewayTicketUsecase,
  type ConsumeGatewayTicketCommand,
} from "./consume-gateway-ticket.usecase";
import {
  createIssueGatewayTicketUsecase,
  type IssueGatewayTicketCommand,
  type IssueGatewayTicketResult,
} from "./issue-gateway-ticket.usecase";
import { markAsRead, type MarkAsReadResult } from "./mark-as-read.usecase";
import { postSessionStartedSystemMessage } from "./post-system-message.usecase";
import { replyThreadMessage, sendChannelMessage, sendDMMessage } from "./send-message.usecase";
import { syncStreamMessages, type SyncStreamMessagesResult } from "./sync-stream-messages.usecase";

export type RealtimeChatUsecases = {
  issueGatewayTicket: (command: IssueGatewayTicketCommand) => Promise<IssueGatewayTicketResult>;
  consumeGatewayTicket: (
    command: ConsumeGatewayTicketCommand,
  ) => Promise<ConsumeGatewayTicketResponse>;
  sendChannelMessage: (request: SendChannelMessageRequest) => Promise<MessageCommandResponse>;
  sendDMMessage: (request: SendDMMessageRequest) => Promise<MessageCommandResponse>;
  replyThreadMessage: (request: ReplyThreadMessageRequest) => Promise<MessageCommandResponse>;
  markAsRead: (request: MarkReadCursorRequest) => Promise<MarkAsReadResult>;
  syncStreamMessages: (request: SyncStreamMessagesRequest) => Promise<SyncStreamMessagesResult>;
  postSessionStartedSystemMessage: (
    request: PostSessionStartedSystemMessageRequest,
  ) => Promise<MessageCommandResponse>;
};

export function createRealtimeChatUsecases(
  deps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions,
): RealtimeChatUsecases {
  return {
    issueGatewayTicket: createIssueGatewayTicketUsecase(deps, options),
    consumeGatewayTicket: createConsumeGatewayTicketUsecase(deps),
    sendChannelMessage: (request) => sendChannelMessage(request, deps, options),
    sendDMMessage: (request) => sendDMMessage(request, deps, options),
    replyThreadMessage: (request) => replyThreadMessage(request, deps, options),
    markAsRead: (request) => markAsRead(request, deps),
    syncStreamMessages: (request) => syncStreamMessages(request, deps, options),
    postSessionStartedSystemMessage: (request) => postSessionStartedSystemMessage(request, deps),
  };
}
