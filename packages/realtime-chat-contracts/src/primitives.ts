export type UserId = string;
export type WorkspaceId = string;
export type ChannelId = string;
export type DMConversationId = string;
export type ThreadId = string;
export type StreamId = string;
export type MessageId = string;
export type ClientMessageId = string;
export type CommandId = string;
export type EventId = string;
export type GatewayId = string;
export type GatewaySessionId = string;
export type GatewayTicket = string;
export type RequestId = string;
export type ISODateTime = string;

export type StreamType = 'CHANNEL' | 'DM' | 'THREAD';
export type MessageType = 'USER' | 'SYSTEM';

export type TextMessageContentDto = {
  kind: 'text';
  text: string;
};

export type SystemMessageContentDto = {
  kind: 'system';
  text: string;
  metadata?: Record<string, string>;
};

export type MessageContentDto = TextMessageContentDto | SystemMessageContentDto;
