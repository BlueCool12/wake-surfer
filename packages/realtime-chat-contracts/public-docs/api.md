# @wake-surfer/realtime-chat-contracts 공개 API

consumer는 package root에서만 import합니다. `src/**` deep import는 public contract가 아닙니다.

```ts
import type {
  RealtimeChatClientEvent,
  RealtimeChatServerEvent,
  RealtimeChatSocketEvent,
  MessageCommandResponse,
  OutboundMessageDeliveryRequested
} from '@wake-surfer/realtime-chat-contracts';
```

## Export groups

| 그룹 | exports |
| --- | --- |
| primitive | `UserId`, `WorkspaceId`, `ChannelId`, `DMConversationId`, `ThreadId`, `StreamId`, `MessageId`, `ClientMessageId`, `CommandId`, `EventId`, `GatewayId`, `GatewaySessionId`, `GatewayTicket`, `RequestId`, `ISODateTime`, `StreamType`, `MessageType`, `TextMessageContentDto`, `SystemMessageContentDto`, `MessageContentDto` |
| error code | `RealtimeChatErrorCode`, `REALTIME_CHAT_ERROR_CODES` |
| socket client event | `ChatChannelMessageSendEvent`, `ChatDMMessageSendEvent`, `ChatThreadMessageReplyEvent`, `ChatChannelReadMarkEvent`, `ChatStreamSyncEvent`, `RealtimeChatClientEvent` |
| socket server event | `GatewayConnectedEvent`, `GatewayConnectionRejectedEvent`, `GatewayErrorEvent`, `ChatMessageAcceptedEvent`, `ChatMessageRejectedEvent`, `ChatMessageCreatedEvent`, `ChatStreamSyncedEvent`, `ChatReadCursorUpdatedEvent`, `RealtimeChatServerEvent` |
| socket union | `RealtimeChatSocketEvent`, `RealtimeChatClientEventType`, `RealtimeChatServerEventType` |
| HTTP DTO | `IssueGatewayTicketRequest`, `IssueGatewayTicketResponse`, `ConsumeGatewayTicketRequest`, `ConsumeGatewayTicketResponse`, `SendChannelMessageRequest`, `SendDMMessageRequest`, `ReplyThreadMessageRequest`, `PostSessionStartedSystemMessageRequest`, `MessageAcceptedResponse`, `MessageRejectedResponse`, `MessageCommandResponse`, `PublicMessageDto`, `MarkReadCursorRequest`, `MarkReadCursorResponse`, `SyncStreamMessagesRequest`, `SyncStreamMessagesResponse` |
| integration event | `OutboundMessageDeliveryRequested`, `CollaborationSessionStarted`, `PresenceChanged` |

## Primitive semantics

All ID aliases are string contracts. `ISODateTime` is also a string contract and producers must serialize it with `Date#toISOString()`.

```ts
type StreamType = 'CHANNEL' | 'DM' | 'THREAD';
type MessageType = 'USER' | 'SYSTEM';

type TextMessageContentDto = {
  kind: 'text';
  text: string;
};

type SystemMessageContentDto = {
  kind: 'system';
  text: string;
  metadata?: Record<string, string>;
};

type MessageContentDto = TextMessageContentDto | SystemMessageContentDto;
```

## Error codes

```ts
type RealtimeChatErrorCode =
  | 'INVALID_PAYLOAD'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'GATEWAY_TICKET_MISSING'
  | 'GATEWAY_TICKET_INVALID_OR_EXPIRED'
  | 'GATEWAY_TICKET_ALREADY_CONSUMED'
  | 'GATEWAY_SESSION_NOT_FOUND'
  | 'CHANNEL_ACCESS_DENIED'
  | 'DM_ACCESS_DENIED'
  | 'THREAD_ACCESS_DENIED'
  | 'MESSAGE_CONTENT_INVALID'
  | 'MESSAGE_SAVE_FAILED'
  | 'STREAM_NOT_FOUND'
  | 'API_UNAVAILABLE'
  | 'INTERNAL_ERROR';
```

## HTTP DTOs

Gateway ticket:

```ts
type IssueGatewayTicketRequest = {
  actorId: UserId;
  workspaceId?: WorkspaceId;
};

type IssueGatewayTicketResponse = {
  ticket: GatewayTicket;
  gatewayUrl?: string;
  expiresAt: ISODateTime;
};

type ConsumeGatewayTicketRequest = {
  ticket: GatewayTicket;
};

type ConsumeGatewayTicketResponse =
  | {
      status: 'consumed';
      ticket: {
        actorId: UserId;
        workspaceId?: WorkspaceId;
        consumedAt: ISODateTime;
      };
    }
  | {
      status: 'rejected';
      reason: RealtimeChatErrorCode;
      message?: string;
    };
```

`IssueGatewayTicketRequest`는 actor/workspace 식별 정보만 표현합니다. gateway URL과 ticket TTL은 feature package mount configuration의 영역이며 request DTO에 포함하지 않습니다.
`ConsumeGatewayTicketRequest`는 gateway process가 API internal endpoint로 전달하는 raw ticket만 표현합니다. ticket hash 계산과 atomic consume 정책은 feature package API adapter/usecase가 처리합니다.

Message command DTOs:

```ts
type SendChannelMessageRequest = {
  requestId: RequestId;
  actorId: UserId;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  clientMessageId: ClientMessageId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

type SendDMMessageRequest = {
  requestId: RequestId;
  actorId: UserId;
  dmConversationId: DMConversationId;
  clientMessageId: ClientMessageId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

type ReplyThreadMessageRequest = {
  requestId: RequestId;
  actorId: UserId;
  threadId: ThreadId;
  clientMessageId: ClientMessageId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};
```

System message DTO:

```ts
type PostSessionStartedSystemMessageRequest = {
  requestId: RequestId;
  sourceEventId: string;
  actorId?: UserId;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  sessionId: string;
  title?: string;
  occurredAt: ISODateTime;
};
```

Message response DTOs:

```ts
type MessageAcceptedResponse = {
  status: 'accepted';
  commandId: CommandId;
  clientMessageId?: ClientMessageId;
  messageId: MessageId;
  streamId: StreamId;
  streamType: StreamType;
  sequence: number;
  serverCreatedAt: ISODateTime;
};

type MessageRejectedResponse = {
  status: 'rejected';
  commandId: CommandId;
  clientMessageId?: ClientMessageId;
  reason: RealtimeChatErrorCode;
  message?: string;
};

type MessageCommandResponse =
  | MessageAcceptedResponse
  | MessageRejectedResponse;
```

Read cursor and sync DTOs:

```ts
type MarkReadCursorRequest = {
  requestId: string;
  actorId: UserId;
  streamId: StreamId;
  lastReadSequence: number;
};

type MarkReadCursorResponse = {
  status: 'advanced' | 'unchanged';
  commandId: CommandId;
  streamId: StreamId;
  lastReadSequence: number;
  updatedAt: ISODateTime;
};

type SyncStreamMessagesRequest = {
  requestId: RequestId;
  actorId: UserId;
  streamId: StreamId;
  afterSequence?: number;
  beforeSequence?: number;
  limit?: number;
};

type SyncStreamMessagesResponse = {
  streamId: StreamId;
  messages: PublicMessageDto[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};
```

Public message DTO:

```ts
type PublicMessageDto = {
  messageId: MessageId;
  streamId: StreamId;
  streamType: StreamType;
  sequence: number;
  senderId?: UserId;
  messageType: 'USER' | 'SYSTEM';
  content: MessageContentDto;
  createdAt: ISODateTime;
};
```

## Socket client events

Supported client event `type` strings:

- `chat.channel.message.send`
- `chat.dm.message.send`
- `chat.thread.message.reply`
- `chat.channel.read.mark`
- `chat.stream.sync`

Client event payloads use `commandId` as the request correlation id. Gateway maps it to API request `requestId`.

```ts
type ChatChannelMessageSendEvent = {
  type: 'chat.channel.message.send';
  commandId: CommandId;
  clientMessageId: ClientMessageId;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

type ChatDMMessageSendEvent = {
  type: 'chat.dm.message.send';
  commandId: CommandId;
  clientMessageId: ClientMessageId;
  dmConversationId: DMConversationId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

type ChatThreadMessageReplyEvent = {
  type: 'chat.thread.message.reply';
  commandId: CommandId;
  clientMessageId: ClientMessageId;
  threadId: ThreadId;
  content: TextMessageContentDto;
  sentAtClient: ISODateTime;
};

type ChatChannelReadMarkEvent = {
  type: 'chat.channel.read.mark';
  commandId: CommandId;
  streamId: StreamId;
  lastReadSequence: number;
};

type ChatStreamSyncEvent = {
  type: 'chat.stream.sync';
  commandId: CommandId;
  streamId: StreamId;
  afterSequence: number;
  beforeSequence?: number;
  limit?: number;
};
```

## Socket server events

Supported server event `type` strings:

- `gateway.connected`
- `gateway.connection.rejected`
- `gateway.error`
- `chat.message.accepted`
- `chat.message.rejected`
- `chat.message.created`
- `chat.stream.synced`
- `chat.read-cursor.updated`

Server event payloads are serialized by the gateway as JSON strings.

## Integration events

```ts
type OutboundMessageDeliveryRequested = {
  eventId: EventId;
  eventType: 'OutboundMessageDeliveryRequested';
  occurredAt: ISODateTime;
  streamId: StreamId;
  streamType: StreamType;
  messageId: MessageId;
  sequence: number;
  recipientUserIds: UserId[];
  payload: ChatMessageCreatedEvent;
};

type CollaborationSessionStarted = {
  eventId: EventId;
  eventType: 'CollaborationSessionStarted';
  occurredAt: ISODateTime;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  sessionId: string;
  startedBy?: UserId;
  title?: string;
};

type PresenceChanged = {
  eventId: EventId;
  eventType: 'PresenceChanged';
  occurredAt: ISODateTime;
  workspaceId: WorkspaceId;
  userId: UserId;
  status: 'online' | 'away' | 'offline';
};
```
