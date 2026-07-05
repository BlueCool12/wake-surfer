import type {
  IssueGatewayTicketResponse,
  MarkReadCursorRequest,
  MarkReadCursorResponse,
  MessageCommandResponse,
  OutboundMessageDeliveryRequested,
  RealtimeChatErrorCode,
  ReplyThreadMessageRequest,
  SendChannelMessageRequest,
  SendDMMessageRequest,
  SyncStreamMessagesRequest,
  SyncStreamMessagesResponse,
  UserId,
  WorkspaceId,
} from "@wake-surfer/realtime-chat-contracts";

export type ConsumedGatewayTicket = {
  actorId: UserId;
  workspaceId?: WorkspaceId;
  consumedAt?: string;
};

export type GatewayTicketConsumeResult =
  | {
      status: "consumed";
      ticket: ConsumedGatewayTicket;
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export type GatewayTicketConsumePort = {
  consume: (ticketValue: string) => Promise<GatewayTicketConsumeResult>;
};

export type RealtimeChatApiClientPort = {
  issueGatewayTicket?: (input: {
    actorId: UserId;
    workspaceId?: WorkspaceId;
  }) => Promise<IssueGatewayTicketResponse>;
  sendChannelMessage: (request: SendChannelMessageRequest) => Promise<MessageCommandResponse>;
  sendDMMessage: (request: SendDMMessageRequest) => Promise<MessageCommandResponse>;
  replyThreadMessage: (request: ReplyThreadMessageRequest) => Promise<MessageCommandResponse>;
  markReadCursor: (request: MarkReadCursorRequest) => Promise<MarkReadCursorResponse>;
  syncStreamMessages: (request: SyncStreamMessagesRequest) => Promise<SyncStreamMessagesResponse>;
};

export type OutboundEventSubscription = {
  unsubscribe: () => void | Promise<void>;
};

export type OutboundEventBusPort = {
  subscribe: (
    handler: (event: OutboundMessageDeliveryRequested) => void | Promise<void>,
  ) => OutboundEventSubscription | Promise<OutboundEventSubscription>;
};

export type ClockPort = {
  now: () => Date;
};

export type IdGeneratorPort = {
  generateId: (scope: string) => string;
};

export type LoggerPort = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
};

export type MetricsPort = {
  increment: (name: string, tags?: Record<string, string>) => void;
};

export type RealtimeChatGatewayRuntimeDeps = {
  chatApiClient: RealtimeChatApiClientPort;
  gatewayTicketPort: GatewayTicketConsumePort;
  outboundEventBus: OutboundEventBusPort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  logger: LoggerPort;
  metrics?: MetricsPort;
};
