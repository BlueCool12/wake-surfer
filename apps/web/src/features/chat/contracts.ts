/**
 * `@wake-surfer/realtime-chat-contracts`의 프론트 소비분을 로컬에 미러링한 것.
 *
 * 백엔드(`feat/3-realtime-room-chat`)의 계약 패키지가 아직 이 브랜치에 없어서
 * 임시로 여기 둔다. 두 브랜치가 합쳐지면 이 파일을 지우고
 * `import type { ... } from "@wake-surfer/realtime-chat-contracts"`로 갈아끼운다.
 *
 * 형태는 packages/realtime-chat-contracts/public-docs/api.md를 그대로 따른다.
 */

// primitive — 모두 string 계약
export type UserId = string;
export type WorkspaceId = string;
export type ChannelId = string;
export type StreamId = string;
export type MessageId = string;
export type ClientMessageId = string;
export type CommandId = string;
export type RequestId = string;
export type ISODateTime = string;

export type StreamType = "CHANNEL" | "DM" | "THREAD";
export type MessageType = "USER" | "SYSTEM";

export type TextMessageContentDto = {
  kind: "text";
  text: string;
};

export type SystemMessageContentDto = {
  kind: "system";
  text: string;
  metadata?: Record<string, string>;
};

export type MessageContentDto = TextMessageContentDto | SystemMessageContentDto;

export type PublicMessageDto = {
  messageId: MessageId;
  streamId: StreamId;
  streamType: StreamType;
  sequence: number;
  senderId?: UserId;
  messageType: MessageType;
  content: MessageContentDto;
  createdAt: ISODateTime;
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
  reason: string;
  message?: string;
};
