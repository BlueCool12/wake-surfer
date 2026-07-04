# @wake-surfer/realtime-chat-contracts 공개 API

consumer는 package root에서만 import합니다.

```ts
import type {
  RealtimeChatClientEvent,
  RealtimeChatServerEvent,
  MessageCommandResponse,
  OutboundMessageDeliveryRequested
} from '@wake-surfer/realtime-chat-contracts';
```

공개 export 그룹:

| 그룹 | 대표 export |
| --- | --- |
| primitive | `UserId`, `WorkspaceId`, `ChannelId`, `StreamId`, `MessageId`, `ISODateTime` |
| error code | `RealtimeChatErrorCode`, `REALTIME_CHAT_ERROR_CODES` |
| socket client event | `RealtimeChatClientEvent`, `ChatChannelMessageSendEvent`, `ChatStreamSyncEvent` |
| socket server event | `RealtimeChatServerEvent`, `ChatMessageAcceptedEvent`, `ChatMessageCreatedEvent`, `GatewayErrorEvent` |
| HTTP DTOs | `IssueGatewayTicketRequest`, `SendChannelMessageRequest`, `MessageCommandResponse`, `SyncStreamMessagesResponse` |
| integration event | `OutboundMessageDeliveryRequested`, `CollaborationSessionStarted`, `PresenceChanged` |

지원되는 import path는 package root뿐입니다. `src/**` deep import는 public contract가 아닙니다.
