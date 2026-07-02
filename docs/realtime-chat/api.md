# API And Event Contract

이 문서는 리포트의 command, event, response shape를 구현자가 계약으로 찾아볼 수 있게
분리한다. 실제 TypeScript schema는 아직 없다.

## Commands

| Command | Owner | Input identity | Success event/result | Invariant |
| --- | --- | --- | --- | --- |
| `IssueGatewayTicket` | API / Gateway Ticket | `userId`, assigned gateway, TTL | `GatewayTicketIssued` | ticket 원문은 client에만 주고 저장소에는 hash를 둔다. |
| `ConsumeGatewayTicket` | Gateway | raw ticket value | `GatewayTicketConsumed` or reject | consume은 한 번만 성공한다. |
| `SendChannelMessage` | Chat | `actorId`, `workspaceId`, `channelId`, `clientMessageId` | `chat.message.accepted`, `ChatMessageSent` | 저장 전 permission check가 성공해야 한다. |
| `SendDMMessage` | Chat | `actorId`, `dmConversationId`, `clientMessageId` | `chat.message.accepted`, `ChatMessageSent` | sender는 DM participant여야 한다. |
| `ReplyThreadMessage` | Chat | `actorId`, root message/thread id, `clientMessageId` | `ThreadReplyPosted` | actor는 parent stream에 접근 가능해야 한다. |
| `MarkChannelAsRead` | Chat | `userId`, `streamId`, requested sequence | `ReadCursorAdvanced` or no-op | requested sequence가 현재 cursor보다 클 때만 갱신한다. |
| `PostSystemMessage` | Chat policy | source event type/id, channel stream | `SystemMessageCreated` | 같은 source event는 중복 system message를 만들지 않는다. |
| `SyncChatStream` | Chat query | `streamId`, `afterSequence` | `chat.stream.synced` | response는 `sequence > afterSequence`만 반환한다. |

## Send Message Contract

Request:

```json
{
  "type": "chat.channel.message.send",
  "commandId": "cmd-001",
  "clientMessageId": "local-msg-abc-123",
  "actorId": "user-1",
  "workspaceId": "ws-1",
  "channelId": "ch-1",
  "content": {
    "type": "TEXT",
    "text": "영희야 안녕?"
  },
  "sentAtClient": "2026-07-02T10:00:00+09:00"
}
```

Accepted response:

```json
{
  "type": "chat.message.accepted",
  "clientMessageId": "local-msg-abc-123",
  "messageId": "msg-999",
  "streamId": "channel-ch-1",
  "sequence": 184,
  "serverCreatedAt": "2026-07-02T10:00:01+09:00"
}
```

The ACK means validated, persisted, and assigned `streamId + sequence`. It does not mean every
recipient received realtime push.

## Events

| Event | Producer | Consumer | Contract |
| --- | --- | --- | --- |
| `GatewayTicketIssued` | API | Client | client receives raw ticket and assigned gateway URL. |
| `GatewayTicketConsumed` | Gateway | Gateway session workflow | RDB consume affected one row. |
| `GatewaySessionRegistered` | Gateway | Presence policy | local socket session is bound to user. |
| `ChatMessageSent` | Chat | Delivery, read model | message exists with `streamId + sequence`. |
| `OutboundMessageDeliveryRequested` | Chat | Event bus / gateway runtimes | realtime push may fail without rolling back message. |
| `ReadCursorAdvanced` | Chat | unread projection | cursor advanced for one user and one stream. |
| `SystemMessageCreated` | Chat policy | Delivery, timeline projection | system message was persisted in a stream. |
| `UserStatusChanged` | Presence | Chat UI projection / delivery | status display event, not message persistence input. |

## Storage Contract

| Table | Key | Critical invariant |
| --- | --- | --- |
| `conversation_streams` | `stream_id` | `last_sequence` is updated under stream row lock. |
| `messages` | `message_id` | unique `(stream_id, sequence)`. |
| `message_idempotency_keys` | `idempotency_key` | retry returns existing `messageId` and `sequence`. |
| `read_cursors` | `(user_id, stream_id)` | `last_read_sequence` never decreases. |
| `gateway_tickets` | `ticket_id` | raw ticket value is not stored; hash consume is atomic. |

## Read APIs

| Query | Use | Ordering |
| --- | --- | --- |
| `GET /channels/{channelId}/messages?afterSequence=N` | catch up after missed push | ascending `sequence` in channel stream |
| `GET /channels/{channelId}/messages?beforeSequence=N` | pagination backward | descending or bounded by stream sequence |
| `GET /dms/{dmConversationId}/messages?afterSequence=N` | DM catch-up | DM stream sequence |
| `GET /threads/{threadId}/messages?afterSequence=N` | thread catch-up | thread stream sequence |
| `chat.stream.sync` socket command | reconnect gap fill | `sequence > afterSequence` |
