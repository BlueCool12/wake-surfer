# Usage Flows

이 문서는 caller가 어떤 경계를 어떤 순서로 사용해야 하는지 기록한다.

## Gateway Ticket And Connect

```txt
Client -> API: IssueGatewayTicket
API -> RDB: insert ticket hash, userId, expiresAt, assigned gateway
API -> Client: raw ticket + gatewayUrl
Client -> Gateway: WebSocket connect(ticket)
Gateway -> RDB: atomic consume by ticket hash
Gateway -> SessionRegistry: register local session
Gateway -> Client: connected or rejected
```

Rules:

| Step | Rule |
| --- | --- |
| Issue | ticket 원문은 client response에만 포함한다. |
| Store | DB에는 ticket hash만 저장한다. |
| Consume | `consumed_at IS NULL AND expires_at > now` update가 한 row만 바꿔야 성공이다. |
| Register | consume 실패 시 gateway session을 만들지 않는다. |

## Send Channel Message

```txt
Client -> Gateway: chat.message.send(clientMessageId, channelId, content)
Gateway -> Gateway: size, parse, session validation
Gateway -> Chat API: SendChannelMessage
Chat API -> Permission: canWrite(actorId, channelId)
Chat API -> RDB: lock stream, assign next sequence, insert message, update stream
Chat API -> Gateway: chat.message.accepted(messageId, streamId, sequence)
Chat API -> OutboundEventBus: OutboundMessageDeliveryRequested
Gateway -> recipient sockets: push if local session exists
```

Gateway usage rule: gateway can reject malformed transport input, but it must not make final chat
permission decisions.

## Retry And Idempotency

The client reuses `clientMessageId` for retries.

```txt
same senderId + streamId + clientMessageId
  -> return existing messageId + sequence
  -> do not insert another message
```

This handles the case where the DB commit succeeded but the client missed the ACK.

## Mark As Read

```txt
Client -> Chat API: MarkChannelAsRead(streamId, requestedSequence)
Chat API -> RDB: read current cursor

if requestedSequence > currentLastReadSequence:
  update cursor
  emit ReadCursorAdvanced
else:
  no-op
```

Read cursor is private user state. It clears that user's unread badge, but it is not a public
"read receipt" event for other users.

## Recover Missed Realtime Delivery

Realtime push is not authoritative. A recipient catches up by stream sequence.

```txt
Client stores lastSeenSequence per stream.
Client reconnects or opens a channel.
Client requests messages after lastSeenSequence.
Server returns persisted messages with sequence greater than that value.
```

Socket command shape:

```json
{
  "type": "chat.stream.sync",
  "streamId": "channel-ch-1",
  "afterSequence": 184
}
```

## System Message From Collaboration Session

```txt
Collaboration Session -> Chat: SessionStarted(sessionId, channelId)
Chat -> RDB: idempotency key SYSTEM_MESSAGE:SessionStarted:{sessionId}
Chat -> stream: PostSystemMessage
Chat -> Delivery: OutboundMessageDeliveryRequested
```

If the same source event was already recorded, the policy does nothing.
