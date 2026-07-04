import type {
  ChannelId,
  ClientMessageId,
  CommandId,
  DMConversationId,
  ISODateTime,
  StreamId,
  TextMessageContentDto,
  ThreadId,
  WorkspaceId
} from '../primitives';

export type ChatChannelMessageSendEvent = {
  type: 'chat.channel.message.send';
  commandId: CommandId;
  clientMessageId: ClientMessageId;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

export type ChatDMMessageSendEvent = {
  type: 'chat.dm.message.send';
  commandId: CommandId;
  clientMessageId: ClientMessageId;
  dmConversationId: DMConversationId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

export type ChatThreadMessageReplyEvent = {
  type: 'chat.thread.message.reply';
  commandId: CommandId;
  clientMessageId: ClientMessageId;
  threadId: ThreadId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

export type ChatChannelReadMarkEvent = {
  type: 'chat.channel.read.mark';
  commandId: CommandId;
  streamId: StreamId;
  lastReadSequence: number;
};

export type ChatStreamSyncEvent = {
  type: 'chat.stream.sync';
  commandId: CommandId;
  streamId: StreamId;
  afterSequence: number;
  beforeSequence?: number;
  limit?: number;
};

export type RealtimeChatClientEvent =
  | ChatChannelMessageSendEvent
  | ChatDMMessageSendEvent
  | ChatThreadMessageReplyEvent
  | ChatChannelReadMarkEvent
  | ChatStreamSyncEvent;
