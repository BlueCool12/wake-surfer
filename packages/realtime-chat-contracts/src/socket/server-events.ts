import type { RealtimeChatErrorCode } from "../error-codes";
import type {
  ClientMessageId,
  CommandId,
  GatewayId,
  GatewaySessionId,
  ISODateTime,
  MessageContentDto,
  MessageId,
  MessageType,
  StreamId,
  StreamType,
  UserId,
} from "../primitives";

export type GatewayConnectedEvent = {
  type: "gateway.connected";
  sessionId: GatewaySessionId;
  gatewayId: GatewayId;
  connectedAt: ISODateTime;
};

export type GatewayConnectionRejectedEvent = {
  type: "gateway.connection.rejected";
  reason: RealtimeChatErrorCode;
  message?: string;
};

export type GatewayErrorEvent = {
  type: "gateway.error";
  reason: RealtimeChatErrorCode;
  commandId?: CommandId;
  message?: string;
  retryable?: boolean;
};

export type ChatMessageAcceptedEvent = {
  type: "chat.message.accepted";
  commandId: CommandId;
  clientMessageId: ClientMessageId;
  messageId: MessageId;
  streamId: StreamId;
  sequence: number;
  serverCreatedAt: ISODateTime;
};

export type ChatMessageRejectedEvent = {
  type: "chat.message.rejected";
  commandId: CommandId;
  clientMessageId?: ClientMessageId;
  reason: RealtimeChatErrorCode;
  message?: string;
};

export type ChatMessageCreatedEvent = {
  type: "chat.message.created";
  messageId: MessageId;
  streamId: StreamId;
  streamType: StreamType;
  sequence: number;
  senderId?: UserId;
  messageType: MessageType;
  content: MessageContentDto;
  createdAt: ISODateTime;
};

export type ChatStreamSyncedEvent = {
  type: "chat.stream.synced";
  commandId: CommandId;
  streamId: StreamId;
  messages: ChatMessageCreatedEvent[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

export type ChatReadCursorUpdatedEvent = {
  type: "chat.read-cursor.updated";
  commandId: CommandId;
  streamId: StreamId;
  lastReadSequence: number;
  updatedAt: ISODateTime;
};

export type RealtimeChatServerEvent =
  | GatewayConnectedEvent
  | GatewayConnectionRejectedEvent
  | GatewayErrorEvent
  | ChatMessageAcceptedEvent
  | ChatMessageRejectedEvent
  | ChatMessageCreatedEvent
  | ChatStreamSyncedEvent
  | ChatReadCursorUpdatedEvent;
