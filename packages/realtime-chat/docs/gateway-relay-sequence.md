# 게이트웨이 중계 흐름

## 문서 연결

- 문서 색인: [Realtime Chat Docs Index](index.md)
- 결정 문서: [Gateway Relay Architecture](gateway-relay-architecture.md)
- 원천 리포트: [도메인 이벤트 스토밍 보고서](../../../docs/realtime-chat/domain-event-storming-report.md)

이 문서는 실시간 채팅의 핵심 흐름을 다이어그램으로 표현한다. 중요한 기준은 다음 세 가지다.

1. Gateway는 전송 계층을 맡고, Chat API가 도메인 판단을 맡는다.
2. 메시지 정렬은 `streamId + sequence`로 한다.
3. sender ACK와 recipient realtime delivery는 분리한다.

## 전체 구성

```mermaid
flowchart LR
  Client["클라이언트"]
  Api["realtime-chat-api"]
  Gateway["realtime-chat-gateway"]
  TicketDb["gateway_tickets\nRDB"]
  ChatDb["conversation_streams\nmessages\nread_cursors"]
  Permission["Workspace / Permission"]
  Bus["OutboundEventBus\nMVP: in-memory/mock 가능\n서버군: broker adapter 필요"]

  Client -- "HTTP 인증 / 티켓 요청" --> Api
  Api -- "ticket hash 저장" --> TicketDb
  Api -- "raw ticket + gateway URL" --> Client

  Client -- "WebSocket connect(ticket)" --> Gateway
  Gateway -- "atomic consume" --> TicketDb
  Gateway -- "local session bind" --> Gateway

  Client -- "chat.message.send" --> Gateway
  Gateway -- "transport validation 후 relay" --> Api
  Api -- "canWrite?" --> Permission
  Api -- "stream lock / message insert" --> ChatDb
  Api -- "delivery event publish" --> Bus
  Bus -- "gateway fan-out" --> Gateway
  Gateway -- "local socket push" --> Client
```

## 1. 웹소켓 접속과 RDB Ticket Consume

```mermaid
sequenceDiagram
  autonumber
  participant C as 클라이언트
  participant API as realtime-chat-api
  participant DB as RDB gateway_tickets
  participant G as realtime-chat-gateway
  participant SR as Local SessionRegistry

  C->>API: IssueGatewayTicket(userId)
  API->>API: raw ticket 생성
  API->>DB: insert(ticket_value_hash, userId, gatewayUrl, expiresAt)
  API-->>C: raw ticket + gatewayUrl + expiresAt

  C->>G: WebSocket connect(raw ticket)
  G->>G: ticket hash 계산
  G->>DB: UPDATE consumed_at where hash and not consumed and not expired

  alt affected rows = 1
    DB-->>G: consume success
    G->>SR: bind(userId, sessionId, gatewayId)
    G-->>C: WebSocket connected
  else affected rows = 0
    DB-->>G: consume failed
    G-->>C: WebSocketConnectionRejected
  end
```

티켓은 한 번만 성공해야 한다. 같은 ticket을 두 gateway가 동시에 소비하려고 해도 RDB update가 한쪽만 성공해야 한다.

## 2. 메시지 전송, Stream Sequence, Sender ACK

```mermaid
sequenceDiagram
  autonumber
  participant C as 철수 클라이언트
  participant G as 게이트웨이
  participant API as Chat API
  participant P as Permission
  participant DB as RDB chat tables
  participant B as OutboundEventBus
  participant Y as 영희 클라이언트

  C->>G: chat.message.send(clientMessageId, channelId, content)
  G->>G: frame size / JSON parse / session 검증
  G->>API: SendChannelMessage(actorId, channelId, clientMessageId, content)

  API->>P: canWrite(actorId, channelId)
  P-->>API: allowed

  API->>DB: SELECT conversation_stream FOR UPDATE
  API->>DB: nextSequence = lastSequence + 1
  API->>DB: INSERT message(streamId, sequence, clientMessageId)
  API->>DB: UPDATE stream.lastSequence
  API->>DB: INSERT idempotency key
  DB-->>API: messageId, streamId, sequence

  API-->>G: chat.message.accepted(messageId, streamId, sequence)
  G-->>C: sender ACK

  API->>B: OutboundMessageDeliveryRequested(messageId, streamId, sequence)
  B-->>Y: gateway fan-out 후 socket push
```

sender ACK의 의미:

```txt
서버가 메시지를 검증했고,
DB에 저장했고,
stream sequence를 발급했다.
```

sender ACK가 의미하지 않는 것:

```txt
모든 수신자가 realtime push를 받았다.
```

## 3. 멱등성 재시도

```mermaid
sequenceDiagram
  autonumber
  participant C as 클라이언트
  participant G as 게이트웨이
  participant API as Chat API
  participant DB as RDB

  C->>G: chat.message.send(clientMessageId=local-123)
  G->>API: SendChannelMessage(local-123)
  API->>DB: message 저장 + idempotency key 저장
  DB-->>API: messageId=msg-999, sequence=184
  API--xG: ACK 응답 중 네트워크 단절

  C->>G: retry chat.message.send(clientMessageId=local-123)
  G->>API: SendChannelMessage(local-123)
  API->>DB: find by senderId + streamId + clientMessageId
  DB-->>API: existing msg-999, sequence=184
  API-->>G: chat.message.accepted(msg-999, sequence=184)
  G-->>C: 기존 결과 반환
```

같은 `senderId + streamId + clientMessageId` 요청은 새 메시지를 만들지 않는다.

## 4. 배달 실패와 afterSequence 복구

```mermaid
sequenceDiagram
  autonumber
  participant API as Chat API
  participant DB as RDB chat tables
  participant B as OutboundEventBus
  participant Y as 영희 클라이언트

  API->>DB: message commit(messageId=msg-1000, streamId=channel-ch-1, sequence=185)
  API-->>API: sender ACK 가능 상태
  API->>B: publish delivery event

  alt publish 성공
    B-->>Y: realtime socket push(sequence=185)
  else publish 실패
    API-->>API: MVP에서는 message rollback 안 함
    Y->>API: GET /channels/ch-1/messages?afterSequence=184
    API->>DB: select messages where streamId and sequence > 184
    DB-->>API: msg-1000 sequence=185
    API-->>Y: missed messages
  end
```

Realtime push는 편의 경로다. 저장된 메시지와 stream sequence가 복구의 기준이다.

## 5. 읽음 처리

```mermaid
sequenceDiagram
  autonumber
  participant C as 클라이언트
  participant API as Chat API
  participant DB as read_cursors
  participant P as Projection

  C->>API: MarkChannelAsRead(streamId=channel-ch-1, sequence=45)
  API->>DB: load current lastReadSequence

  alt requestedSequence > currentLastReadSequence
    API->>DB: update lastReadSequence = 45
    DB-->>API: updated
    API->>P: ReadCursorAdvanced(userId, streamId, 45)
    API-->>C: read cursor advanced
  else requestedSequence <= currentLastReadSequence
    API-->>C: no-op
  end
```

읽음 상태는 유저별 private state다. 다른 사용자에게 공개적인 read receipt로 전파하지 않는다.

## 6. 협업 세션에서 시스템 메시지 생성

```mermaid
sequenceDiagram
  autonumber
  participant S as Collaboration Session
  participant API as Chat API
  participant DB as RDB chat tables
  participant B as OutboundEventBus

  S->>API: SessionStarted(sessionId=pair-123, channelId=ch-1)
  API->>DB: check idempotency key SYSTEM_MESSAGE:SessionStarted:pair-123

  alt first event
    API->>DB: lock channel stream
    API->>DB: insert SYSTEM message + next sequence
    API->>DB: record idempotency key
    DB-->>API: messageId, streamId, sequence
    API->>B: OutboundMessageDeliveryRequested
  else duplicate event
    API-->>API: no-op
  end
```

외부 협업 이벤트가 재전달되어도 같은 시스템 메시지를 중복 생성하지 않는다.

## 1차 구현 해석

| 영역 | 1차 구현 기준 |
| --- | --- |
| Gateway Ticket | RDB 기반 one-time consume |
| Message Store | RDB 기반 `conversation_streams`, `messages`, `message_idempotency_keys`, `read_cursors` |
| Gateway Session | gateway process local in-memory registry |
| Outbound Bus | 단일 프로세스 검증은 in-memory/mock 가능. 분리된 gateway server group에서는 broker adapter 필요 |
| Missed Delivery | `afterSequence` sync로 복구 |

이 구조에서 강한 정합성이 필요한 것은 ticket consume, message persistence, stream sequence, idempotency, read cursor다. Realtime push, unread projection, presence broadcast는 지연되거나 실패해도 다시 계산하거나 sync할 수 있다.
