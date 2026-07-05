# realtime-chat package-owned 흐름 설명서

> 현재 구현은 API adapter와 Gateway adapter를 `packages/realtime-chat` 안에 둡니다. 이 문서의 participant는 단일 feature package 내부 adapter 경계를 기준으로 설명합니다.

## 0. 문서 목적

이 문서는 `apps`를 배포 단위이자 composition root로 보고, 실제 feature 흐름을 `packages/realtime-chat`의 API/Gateway adapter가 처리하는 기준으로 sequence diagram을 정리한 문서입니다.

이 문서의 핵심은 다음입니다.

```txt
apps는 요청을 해석하지 않는다.
apps는 command를 만들지 않는다.
apps는 handler를 구현하지 않는다.
apps는 package module을 mount한다.
```

---

## 1. 전체 런타임 구조

```mermaid
flowchart LR
  C[Client]

  AppAPI[apps/realtime-chat-api\nthin shell]
  AppGW[apps/realtime-chat-gateway\nthin shell]

  PAPI[packages/realtime-chat\nAPI adapter + usecases + domain]
  PGW[packages/realtime-chat\nGateway adapter + router + sessions]
  Contracts[packages/realtime-chat-contracts\npublic DTO/events]

  DB[(RDB)]
  Bus[(Outbound Event Bus)]
  Permission[Workspace / Permission]

  C -->|HTTP| AppAPI
  AppAPI -->|mounted HTTP plugin| PAPI

  C <-->|WebSocket| AppGW
  AppGW -->|mounted WS module| PGW

  PGW -->|public API DTO| PAPI
  PAPI --> DB
  PAPI --> Permission
  PAPI --> Bus
  Bus --> PGW
  PGW --> C

  PAPI --> Contracts
  PGW --> Contracts
```

---

## 2. Flow 1. API app bootstrapping

### 설명

API app은 feature를 구현하지 않고, package module을 HTTP server에 등록합니다.

```mermaid
sequenceDiagram
  autonumber
  participant App as apps/realtime-chat-api main.ts
  participant Server as HTTP Server
  participant Module as packages/realtime-chat API adapter
  participant Resources as DB/Broker/Logger adapters

  App->>App: loadConfig()
  App->>Resources: create generic resources
  App->>Server: createHttpServer()
  App->>Module: mountRealtimeChatApi(Server, options, deps)
  Module->>Module: wire handlers/usecases/domain
  Module->>Server: register route handlers under basePath
  Module-->>App: mounted
  App->>Server: listen(port)
```

### 핵심

```txt
App은 module을 등록할 뿐 SendChannelMessageUsecase를 직접 만들지 않는다.
```

---

## 3. Flow 2. Gateway app bootstrapping

```mermaid
sequenceDiagram
  autonumber
  participant App as apps/realtime-chat-gateway main.ts
  participant HTTP as HTTP Server
  participant WS as WebSocket Server
  participant Module as packages/realtime-chat Gateway adapter
  participant Resources as API client/Broker/Logger adapters

  App->>App: loadConfig()
  App->>Resources: create generic resources
  App->>HTTP: createHttpServer()
  App->>WS: createWebSocketServer(HTTP)
  App->>Module: mountRealtimeChatGateway(WS, options, deps)
  Module->>Module: wire ws handlers/router/session registry/API client
  Module->>WS: register websocket route
  Module->>Resources: subscribe outbound delivery events
  Module-->>App: mounted
  App->>HTTP: listen(port)
```

### 핵심

```txt
App은 ClientEventRouter를 만들지 않는다.
App은 socket event type switch를 하지 않는다.
```

---

## 4. Flow 3. Gateway ticket 발급

### 설명

HTTP request는 app의 server에 도착하지만, handler와 usecase는 API package가 처리합니다.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant App as apps/realtime-chat-api
  participant Handler as packages/realtime-chat API Handler
  participant UC as IssueGatewayTicketUsecase
  participant DB as RDB

  C->>App: POST /api/realtime-chat/gateway-tickets
  App->>Handler: mounted route handler
  Handler->>Handler: validate request DTO
  Handler->>UC: create package-private IssueGatewayTicketCommand
  UC->>UC: ticket raw value + hash + configured TTL 적용
  UC->>DB: INSERT gateway_tickets(hash, userId, expiresAt)
  DB-->>UC: stored
  UC-->>Handler: IssuedGatewayTicket result
  Handler-->>C: ticket + configured gatewayUrl + expiresAt
```

### app이 모르는 것

```txt
- IssueGatewayTicketCommand
- ticket hash 계산 방식
- gateway_tickets table
- TTL 정책
- gatewayUrl 결정
```

---

## 5. Flow 4. WebSocket 접속 성공

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant App as apps/realtime-chat-gateway
  participant Connect as packages/realtime-chat Gateway ConnectHandler
  participant Ticket as GatewayTicketConsumer
  participant DB as RDB or API ticket endpoint
  participant SR as GatewaySessionRegistry

  C->>App: WS connect /ws/realtime-chat?ticket=...
  App->>Connect: mounted websocket connect handler
  Connect->>Connect: extract ticket
  Connect->>Ticket: consume(ticket)
  Ticket->>DB: atomic consume ticket
  DB-->>Ticket: success(userId)
  Ticket-->>Connect: consumed ticket
  Connect->>SR: register(userId, socketId, gatewayId)
  SR-->>Connect: sessionId
  Connect-->>C: gateway.connected(sessionId)
```

### app이 모르는 것

```txt
- ConsumeGatewayTicketCommand
- ticket hash 계산 방식
- GatewaySessionRegistry 자료구조
- gateway.connected payload mapping
```

---

## 6. Flow 5. WebSocket 접속 실패

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant App as apps/realtime-chat-gateway
  participant Connect as packages/realtime-chat Gateway ConnectHandler
  participant Ticket as GatewayTicketConsumer
  participant DB as RDB or API ticket endpoint

  C->>App: WS connect with expired/reused ticket
  App->>Connect: mounted websocket connect handler
  Connect->>Ticket: consume(ticket)
  Ticket->>DB: atomic consume ticket
  DB-->>Ticket: failed
  Ticket-->>Connect: GATEWAY_TICKET_INVALID_OR_EXPIRED
  Connect-->>C: gateway.connection.rejected(reason)
  Connect->>Connect: close socket
```

---

## 7. Flow 6. 채널 메시지 전송 성공

### 설명

Gateway adapter가 socket event를 public API DTO로 변환하고, API adapter가 public DTO를 내부 command로 변환합니다.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant AppGW as apps/realtime-chat-gateway
  participant GW as packages/realtime-chat Gateway adapter
  participant AppAPI as apps/realtime-chat-api
  participant APIHandler as packages/realtime-chat API Handler
  participant UC as SendChannelMessageUsecase
  participant P as Permission
  participant DB as RDB
  participant Bus as OutboundEventBus

  C->>AppGW: socket event chat.channel.message.send
  AppGW->>GW: mounted message handler
  GW->>GW: transport validation
  GW->>GW: map socket event to SendChannelMessageRequest DTO
  GW->>AppAPI: POST internal/public API DTO
  AppAPI->>APIHandler: mounted route handler
  APIHandler->>APIHandler: validate request DTO
  APIHandler->>UC: create package-private SendChannelMessageCommand
  UC->>P: canWrite(actorId, channelId)
  P-->>UC: allowed
  UC->>DB: lock stream + idempotency check + save message
  DB-->>UC: messageId, streamId, sequence
  UC->>Bus: publish OutboundMessageDeliveryRequested
  UC-->>APIHandler: MessageAccepted
  APIHandler-->>GW: MessageAcceptedResponse
  GW-->>C: chat.message.accepted
```

### app이 모르는 것

```txt
apps/realtime-chat-gateway가 모르는 것:
  - SendChannelMessageCommand
  - PermissionPort
  - ConversationStream

apps/realtime-chat-api가 모르는 것:
  - SendChannelMessageCommand
  - stream lock
  - repository
```

둘 다 모릅니다. command와 domain은 `packages/realtime-chat`의 API adapter 내부에 있습니다.

---

## 8. Flow 7. 권한 실패

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant GW as packages/realtime-chat Gateway adapter
  participant API as packages/realtime-chat API adapter
  participant P as Permission

  C->>GW: chat.channel.message.send
  GW->>GW: transport validation success
  GW->>API: SendChannelMessageRequest DTO
  API->>API: DTO -> package-private command
  API->>P: canWrite(actorId, channelId)
  P-->>API: denied
  API-->>GW: MessageRejectedResponse(CHANNEL_ACCESS_DENIED)
  GW-->>C: chat.message.rejected(CHANNEL_ACCESS_DENIED)
```

Gateway는 권한을 계산하지 않고, API 결과를 relay합니다.

---

## 9. Flow 8. ACK 유실 후 clientMessageId 재시도

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant GW as packages/realtime-chat Gateway adapter
  participant API as packages/realtime-chat API adapter
  participant DB as RDB

  C->>GW: chat.channel.message.send(clientMessageId=local-1)
  GW->>API: SendChannelMessageRequest(local-1)
  API->>DB: save message with idempotency key
  DB-->>API: messageId=msg-1, sequence=10
  API-->>GW: MessageAccepted
  GW--xC: ACK lost due to network

  C->>GW: retry same clientMessageId=local-1
  GW->>API: SendChannelMessageRequest(local-1)
  API->>DB: find existing idempotency key
  DB-->>API: existing messageId=msg-1, sequence=10
  API-->>GW: MessageAccepted(existing result)
  GW-->>C: chat.message.accepted(msg-1, sequence=10)
```

멱등성은 API adapter 책임입니다. Gateway adapter는 같은 event를 다시 relay할 뿐입니다.

---

## 10. Flow 9. Outbound delivery fan-out

```mermaid
sequenceDiagram
  autonumber
  participant API as packages/realtime-chat API adapter
  participant Bus as OutboundEventBus
  participant GW1 as packages/realtime-chat Gateway adapter on Gateway-1
  participant GW2 as packages/realtime-chat Gateway adapter on Gateway-2
  participant SR1 as Gateway-1 SessionRegistry
  participant SR2 as Gateway-2 SessionRegistry
  participant C as Recipient Client

  API->>Bus: OutboundMessageDeliveryRequested(recipientUserIds)
  Bus-->>GW1: delivery event
  Bus-->>GW2: delivery event

  GW1->>SR1: find local sessions(recipientUserIds)
  SR1-->>GW1: none
  GW1->>GW1: skip

  GW2->>SR2: find local sessions(recipientUserIds)
  SR2-->>GW2: socket found
  GW2-->>C: chat.message.created
```

Gateway app은 이 event를 직접 구독하지 않습니다. `packages/realtime-chat` Gateway adapter mount가 subscriber를 시작합니다.

---

## 11. Flow 10. delivery publish 실패 후 afterSequence 복구

```mermaid
sequenceDiagram
  autonumber
  participant Sender as Sender Client
  participant API as packages/realtime-chat API adapter
  participant DB as RDB
  participant Bus as OutboundEventBus
  participant Receiver as Receiver Client
  participant GW as packages/realtime-chat Gateway adapter

  Sender->>API: send message request
  API->>DB: save message sequence=185
  DB-->>API: saved
  API--xBus: publish failed
  API-->>Sender: chat.message.accepted(sequence=185)

  Receiver->>GW: chat.stream.sync(afterSequence=184)
  GW->>API: SyncStreamRequest(streamId, afterSequence=184)
  API->>DB: select messages where sequence > 184
  DB-->>API: message sequence=185
  API-->>GW: StreamSyncedResponse
  GW-->>Receiver: chat.stream.synced(messages)
```

MVP에서 push 실패는 허용합니다. 저장된 메시지가 source of truth입니다.

---

## 12. Flow 11. Read cursor 전진

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant GW as packages/realtime-chat Gateway adapter
  participant API as packages/realtime-chat API adapter
  participant DB as RDB

  C->>GW: chat.channel.read.mark(streamId, lastReadSequence=185)
  GW->>GW: transport validation
  GW->>API: MarkReadCursorRequest
  API->>API: DTO -> MarkReadCursorCommand
  API->>DB: get current read cursor
  DB-->>API: current lastReadSequence=120
  API->>DB: update lastReadSequence=185
  DB-->>API: updated
  API-->>GW: ReadCursorAdvanced
  GW-->>C: chat.read-cursor.updated
```

`lastReadSequence`가 기존 값보다 작거나 같으면 API package가 no-op 처리합니다.

---

## 13. Flow 12. Collaboration Session → system message

```mermaid
sequenceDiagram
  autonumber
  participant S as Collaboration Session Context
  participant API as packages/realtime-chat API adapter
  participant DB as RDB
  participant Bus as OutboundEventBus
  participant GW as packages/realtime-chat Gateway adapter
  participant C as Channel Clients

  S-->>API: SessionStarted(sessionId, channelId)
  API->>API: create PostSystemMessageCommand internally
  API->>DB: idempotency check by sourceEventId/sessionId
  API->>DB: lock channel stream + save SYSTEM message
  DB-->>API: messageId, sequence
  API->>Bus: OutboundMessageDeliveryRequested
  Bus-->>GW: delivery event
  GW-->>C: chat.message.created(system message)
```

시스템 메시지 command도 `packages/realtime-chat` API adapter 내부 개념입니다.

---

## 14. 최종 흐름 요약

```txt
HTTP request가 들어온다
→ app server가 package handler로 넘긴다
→ package handler가 DTO를 검증한다
→ package handler가 package-private command를 만든다
→ package usecase가 domain/persistence/port를 사용한다
→ package가 public response DTO를 반환한다
→ app은 모른다
```

```txt
WebSocket event가 들어온다
→ app server가 package WS handler로 넘긴다
→ package router가 event type을 해석한다
→ package가 public API DTO를 만든다
→ API package가 내부 command로 변환한다
→ 결과가 public socket event로 돌아간다
→ app은 모른다
```
