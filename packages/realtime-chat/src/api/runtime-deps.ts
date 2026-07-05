import type {
  ChannelId,
  DMConversationId,
  ISODateTime,
  MessageContentDto,
  MessageId,
  MessageType,
  RealtimeChatErrorCode,
  StreamId,
  StreamType,
  ThreadId,
  UserId,
  WorkspaceId,
} from "@wake-surfer/realtime-chat-contracts";
import type { OutboundMessageDeliveryRequested } from "@wake-surfer/realtime-chat-contracts";

export type RealtimeChatMessageTarget =
  | {
      kind: "channel";
      workspaceId: WorkspaceId;
      channelId: ChannelId;
    }
  | {
      kind: "dm";
      dmConversationId: DMConversationId;
    }
  | {
      kind: "thread";
      threadId: ThreadId;
    };

export type PermissionDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export type PermissionPort = {
  canIssueGatewayTicket?: (input: {
    actorId: UserId;
    workspaceId?: WorkspaceId;
  }) => Promise<PermissionDecision>;
  canWriteMessage: (input: {
    actorId: UserId;
    target: RealtimeChatMessageTarget;
  }) => Promise<PermissionDecision>;
  canReadStream: (input: { actorId: UserId; streamId: StreamId }) => Promise<PermissionDecision>;
  resolveMessageRecipients: (input: {
    actorId?: UserId;
    target: RealtimeChatMessageTarget;
    streamId: StreamId;
  }) => Promise<UserId[]>;
};

export type StoredRealtimeChatMessage = {
  messageId: MessageId;
  streamId: StreamId;
  streamType: StreamType;
  sequence: number;
  senderId?: UserId;
  messageType: MessageType;
  content: MessageContentDto;
  createdAt: ISODateTime;
  idempotencyKey?: string;
};

export type StoredGatewayTicket = {
  ticketValueHash: string;
  actorId: UserId;
  workspaceId?: WorkspaceId;
  issuedAt: ISODateTime;
  expiresAt: ISODateTime;
};

export type StoredGatewayTicketConsumeResult =
  | {
      status: "consumed";
      ticket: {
        actorId: UserId;
        workspaceId?: WorkspaceId;
        consumedAt: ISODateTime;
      };
    }
  | {
      status: "rejected";
      reason: RealtimeChatErrorCode;
      message?: string;
    };

export type StoredReadCursor = {
  actorId: UserId;
  streamId: StreamId;
  lastReadSequence: number;
  updatedAt: ISODateTime;
  advanced: boolean;
};

export type RealtimeChatDbPort = {
  issueGatewayTicket: (ticket: StoredGatewayTicket) => Promise<void>;
  consumeGatewayTicket: (input: {
    ticketValueHash: string;
    consumedAt: ISODateTime;
  }) => Promise<StoredGatewayTicketConsumeResult>;
  findMessageByIdempotencyKey: (
    idempotencyKey: string,
  ) => Promise<StoredRealtimeChatMessage | undefined>;
  appendMessage: (input: {
    messageId: MessageId;
    target: RealtimeChatMessageTarget;
    streamType: StreamType;
    senderId?: UserId;
    messageType: MessageType;
    content: MessageContentDto;
    idempotencyKey?: string;
    createdAt: ISODateTime;
  }) => Promise<StoredRealtimeChatMessage>;
  markReadCursor: (input: {
    actorId: UserId;
    streamId: StreamId;
    lastReadSequence: number;
    updatedAt: ISODateTime;
  }) => Promise<StoredReadCursor>;
  listMessages: (input: {
    streamId: StreamId;
    afterSequence?: number;
    beforeSequence?: number;
    limit: number;
  }) => Promise<{
    messages: StoredRealtimeChatMessage[];
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  }>;
};

export type OutboundEventBusPort = {
  publish: (event: OutboundMessageDeliveryRequested) => Promise<void>;
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

export type TicketHasherPort = {
  hash: (ticketValue: string) => string | Promise<string>;
};

export type RealtimeChatApiRuntimeDeps = {
  db: RealtimeChatDbPort;
  permissionPort: PermissionPort;
  outboundEventBus: OutboundEventBusPort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  logger: LoggerPort;
  metrics?: MetricsPort;
  ticketHasher?: TicketHasherPort;
};
