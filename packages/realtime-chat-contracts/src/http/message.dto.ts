import type { RealtimeChatErrorCode } from "../error-codes";
import type {
  ChannelId,
  ClientMessageId,
  CommandId,
  DMConversationId,
  ISODateTime,
  MessageContentDto,
  MessageId,
  RequestId,
  StreamId,
  StreamType,
  TextMessageContentDto,
  ThreadId,
  UserId,
  WorkspaceId,
} from "../primitives";

export type SendChannelMessageRequest = {
  requestId: RequestId;
  actorId: UserId;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  clientMessageId: ClientMessageId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

export type SendDMMessageRequest = {
  requestId: RequestId;
  actorId: UserId;
  dmConversationId: DMConversationId;
  clientMessageId: ClientMessageId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

export type ReplyThreadMessageRequest = {
  requestId: RequestId;
  actorId: UserId;
  threadId: ThreadId;
  clientMessageId: ClientMessageId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

export type PostSessionStartedSystemMessageRequest = {
  requestId: RequestId;
  sourceEventId: string;
  actorId?: UserId;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  sessionId: string;
  title?: string;
  occurredAt: ISODateTime;
};

export type MessageAcceptedResponse = {
  status: "accepted";
  commandId: CommandId;
  clientMessageId?: ClientMessageId;
  messageId: MessageId;
  streamId: StreamId;
  streamType: StreamType;
  sequence: number;
  serverCreatedAt: ISODateTime;
};

export type MessageRejectedResponse = {
  status: "rejected";
  commandId: CommandId;
  clientMessageId?: ClientMessageId;
  reason: RealtimeChatErrorCode;
  message?: string;
};

export type MessageCommandResponse = MessageAcceptedResponse | MessageRejectedResponse;

export type PublicMessageDto = {
  messageId: MessageId;
  streamId: StreamId;
  streamType: StreamType;
  sequence: number;
  senderId?: UserId;
  messageType: "USER" | "SYSTEM";
  content: MessageContentDto;
  createdAt: ISODateTime;
};
