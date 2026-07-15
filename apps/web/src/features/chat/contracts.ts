/**
 * `@wake-surfer/realtime-chat-message-contracts`로 이전할 프론트 임시 DTO다.
 *
 * 현재 화면은 mock transport와 `SYSTEM` DTO를 함께 사용하므로 즉시 제거하지 않는다. 실제 stream message
 * adapter를 연결할 때 canonical `PublicMessage`의 `senderActorId`, `target`, `content.type = "text"` 형태로
 * 수렴시키고 이 파일을 제거한다.
 *
 * 이 파일의 `streamType`, `messageType`, `senderId`, `kind`는 기존 mock UI 전용 필드다.
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
