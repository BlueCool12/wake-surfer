import type {
  IssueGatewayTicketResponse,
  GatewayId,
  GatewayTicket,
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
} from "@wake-surfer/realtime-chat-contracts";

export type ConsumedGatewayTicket = {
  actorId: UserId;
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
  consume: (input: {
    ticketValue: GatewayTicket;
    gatewayId: GatewayId;
  }) => Promise<GatewayTicketConsumeResult>;
};

export type RealtimeChatApiClientPort = {
  issueGatewayTicket?: () => Promise<IssueGatewayTicketResponse>;
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
