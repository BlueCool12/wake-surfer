# Flow 9 WebSocket 종료·재접속·누락 메시지 동기화 구현 계획

> 상태: 이 문서는 이슈와 작업 브랜치를 만들기 위한 구현 계획이다. 현재 구현 계약이나 확정된 공개 API가 아니다.
> 구현 중 확정된 계약은 해당 provider의 `README.md`, `public-docs/`, `owner-docs/`로 승격하고 이 문서를 agent context route에 포함하지 않는다.

## 1. 목적과 범위

Gateway 장애, 네트워크 변경, 브라우저 offline, 비정상 WebSocket 종료 뒤에도 클라이언트가 새 일회성 ticket으로 연결을 복구하고, 활성 stream별로 마지막 **연속 적용 sequence** 이후의 저장 메시지를 동기화한다.

이 계획이 다루는 흐름은 다음과 같다.

```text
WebSocket 종료 감지
→ 재연결 대기와 backoff
→ API에서 새 gateway ticket 발급
→ 새 WebSocket 연결과 새 Gateway session 수립
→ active stream별 SyncStream(afterSequence) 페이지 조회
→ 실시간 push와 동기화 응답을 동일 규칙으로 병합
→ 누락 없는 연속 sequence까지 lastSeenSequence 전진
→ 미확정 pending 메시지를 같은 clientMessageId로 재시도
```

Flow 9는 연결 복구를 조율하지만, 누락 메시지를 조회하는 서버 기능 자체는 Flow 7 `SyncStream`의 공개 계약을 소비한다. Flow 7이 구현되지 않았다면 Flow 9를 end-to-end 완료할 수 없다.

## 2. 조사한 현재 상태

### 2.1 현재 작업트리

- `apps/realtime-chat-gateway`는 ticket 인증, 로컬 세션 등록, heartbeat, close 시 세션 삭제를 구현한다.
- Gateway는 `WebSocket`을 key로 한 `Map<WebSocket, GatewaySession>`을 사용하며 close 시 `sessions.delete(websocket)`를 수행한다.
- `apps/realtime-chat-api`는 `POST /realtime-chat/gateway-tickets`와 내부 ticket 소비 API만 제공한다.
- ticket은 일회성이며 재접속 때 이전 ticket을 재사용할 수 없다.
- API와 Gateway에는 `SyncStream`, stream read authorization, 페이지 조회, `chat.stream.sync` relay가 없다.
- Gateway에는 연결 성공 application event, WebSocket message envelope parser, 재접속 token이 없다.
- `packages/realtime-chat-database`의 현재 기준 브랜치에는 gateway ticket table만 조립되어 있다.

### 2.2 브랜치 전환 없이 확인한 메시지 전송 브랜치

로컬 `feat/26-message-send`를 `git show`로 확인했다. 이 브랜치는 다음 기반을 제공한다.

- `message_streams.last_sequence`와 `(stream_id, sequence)` unique 조건
- `messages_stream_sequence_idx (stream_id, sequence)`
- `PublicMessage`의 `messageId`, `streamId`, `sequence`, `senderActorId`, `target`, `content`, `createdAt`
- `senderActorId + streamId + clientMessageId` 멱등성
- 같은 `clientMessageId` 재시도에서 기존 accepted message 반환

하지만 다음은 제공하지 않는다.

- stream 메시지 페이지 조회 또는 `SyncStream`
- read authorization port
- `chat.stream.sync`/`chat.stream.synced` WebSocket 계약
- 연결 재시도와 client cursor persistence
- `PublicMessage`의 `clientMessageId`

마지막 항목은 중요하다. ACK를 잃은 송신자가 sync로 자신이 저장한 메시지를 받아도 pending 항목과 직접 연결할 수 없다. 같은 `clientMessageId`를 재전송해 accepted 응답을 받으면 매핑할 수 있으므로 이 계획은 pending 자동 재시도를 사용하되, 서버 계약에 sender 전용 correlation을 추가할지 미결정으로 남긴다.

### 2.3 현재 웹 클라이언트

- `ChatTransport.connect()`는 목에서 아무 일도 하지 않는다.
- `loadHistory()`는 전체 배열을 한 번 반환하며 `afterSequence`와 페이지 개념이 없다.
- `useChatRoom()`이 React `useState`에 메시지 배열과 loading 상태를 소유한다.
- transport는 component effect에서 생성되고 unmount 시 바로 disconnect된다.
- pending은 화면 메모리에만 있고 새로고침·탭 종료를 견디지 못한다.
- `messageId` 중복 제거는 있지만 stream sequence gap과 연속 cursor 규칙이 없다.
- active stream registry, connection state machine, retry timer, 영속 저장소가 없다.

따라서 현재 웹 구조를 그대로 확장하면 socket event, sync 응답, 낙관적 메시지가 여러 React effect와 state copy를 경쟁적으로 갱신하게 된다. Flow 9에서는 React 밖의 pure in-memory 채팅 모델을 기준 상태로 두고 React는 작은 model slice를 렌더링하는 구조로 바꾼다.

## 3. Flow 7 `SyncStream` 의존성

Flow 9 구현 전에 Flow 7이 다음 공개 계약을 제공해야 한다.

### 3.1 서버 유스케이스

```ts
SyncStream(actorId, streamId, afterSequence, pageCursor?, limit?)
```

- Gateway가 인증 session의 `actorId`를 주입하고 client body의 actor ID를 신뢰하지 않는다.
- API가 actor의 stream read 권한을 확인한다.
- `sequence > afterSequence`를 오름차순으로 조회한다.
- 안정적인 페이지 경계, 페이지 상한, 다음 cursor, 완료 여부를 반환한다.
- stream 미존재와 read forbidden을 외부에서 구분할지 보안 정책을 정한다.
- DB 조회는 `(stream_id, sequence)` index를 사용한다.

### 3.2 권장 페이지 계약

계속 새 메시지가 생기는 stream에서 단순히 “페이지 크기보다 작을 때까지” 조회하면 동기화가 끝나지 않을 수 있다. 첫 응답에서 sync snapshot의 상한인 `throughSequence`를 고정하고 다음 페이지도 그 상한까지만 조회하는 방식을 권장한다.

```text
request:
  requestId, streamId, afterSequence, limit, continuationToken?

response:
  requestId, streamId, messages(sequence ASC),
  throughSequence, nextAfterSequence, continuationToken?, hasMore
```

후속 페이지는 다음 조건을 유지한다.

```sql
WHERE stream_id = :streamId
  AND sequence > :pageAfterSequence
  AND sequence <= :throughSequence
ORDER BY sequence ASC
LIMIT :limitPlusOne
```

opaque continuation token을 선택해도 같은 snapshot 상한 의미를 보장해야 한다. 새 실시간 push는 snapshot과 별도로 buffer에 들어오며, sequence 병합기가 순서대로 적용한다.

### 3.3 Gateway relay 계약

- Client → Gateway: `chat.stream.sync`
- Gateway → API: 인증 actor가 포함된 내부 `SyncStream`
- API → Gateway: `StreamSynced` page
- Gateway → Client: `chat.stream.synced`

Gateway는 페이지 내용을 해석하거나 누락 여부를 계산하지 않고 검증된 계약을 relay한다. request/response의 `requestId`로 여러 active stream의 병렬 sync 결과를 연결하고 오래된 연결 세대의 응답을 폐기할 수 있어야 한다.

Flow 7 계약이 별도 이슈에서 확정되면 이 문서의 후보 DTO를 복제하지 않고 해당 contracts package의 공개 export를 사용한다.

## 4. 새 ticket 재발급

모든 연결 시도는 인증된 HTTP 문맥에서 `POST /realtime-chat/gateway-tickets`를 호출해 새 ticket과 `gatewayUrl`을 받는다.

불변조건은 다음과 같다.

- 소비했거나 소비 여부를 알 수 없는 ticket은 재사용하지 않는다.
- ticket 원문은 in-memory 연결 시도 안에서만 쓰고 localStorage, IndexedDB, URL history, log에 저장하지 않는다.
- ticket 발급 요청과 WebSocket 연결은 하나의 connection attempt ID에 묶는다.
- 새 attempt가 시작되면 이전 발급 요청을 `AbortController`로 취소하고 이전 socket callback을 세대 번호로 무효화한다.
- WebSocket 연결 전에 ticket TTL이 임박하면 폐기하고 새로 발급한다.
- `4401`은 ticket 재사용이 아니라 새 ticket 발급으로 복구한다. 반복되면 인증/설정 오류로 승격한다.
- HTTP `401/403`은 자동 무한 재시도하지 않고 `auth_required` 또는 terminal 상태로 보낸다.
- `429`, `5xx`, network error, `1011`, `1013`, `1006`은 정책에 따라 backoff 재시도한다.
- 사용자 요청에 의한 정상 disconnect는 새 ticket을 발급하지 않는다.

문서 스케치에는 Gateway가 DB를 직접 소비하는 것으로 보이지만 현재 구현은 `Gateway → API 내부 endpoint → ticket package → DB`다. Flow 9는 현재 경계를 유지한다.

## 5. 클라이언트 기준 상태

### 5.1 모델 소유권

하나의 인증 actor/workspace realtime session model이 WebSocket 하나와 여러 stream model을 소유한다. channel component마다 socket이나 controller를 만들지 않는다.

```text
RealtimeChatSessionModel
├─ ConnectionModel
├─ ActiveStreamRegistry
│  └─ StreamModel(streamId) * N
├─ PendingOutboundModel
└─ persistence / transport ports
```

모델은 React import가 없는 workspace package에 살고, domain ID로 key된 registry가 component mount와 독립적인 생명주기를 소유한다. React는 `useSyncExternalStore`로 자신이 읽는 가장 작은 submodel만 구독한다.

- 연결 표시 UI는 `ConnectionModel`만 구독한다.
- 메시지 목록은 해당 `StreamModel`만 구독한다.
- pending 전송 표시는 `PendingOutboundModel` 또는 해당 stream slice만 구독한다.
- route unmount는 UI 구독만 제거한다. socket 종료는 domain이 session 종료를 선언할 때만 수행한다.

### 5.2 `lastSeenSequence`

`lastSeenSequence`는 관찰한 최대값이 아니라 **1부터 누락 없이 모델에 적용한 가장 큰 연속 sequence**다.

예를 들어 cursor가 10일 때 실시간 sequence 12가 먼저 오면 12를 buffer하고 cursor는 10에 둔다. `SyncStream(afterSequence=10)`에서 11을 받은 뒤 11, 12를 순서대로 적용하고 cursor를 12로 전진한다.

stream별 모델은 최소한 다음을 가진다.

```text
streamId
contiguousLastSeenSequence
messagesById
messageIdBySequence
outOfOrderBufferBySequence
syncStatus / activeSyncGeneration
snapshotThroughSequence / nextPageCursor
```

cursor는 뒤로 가지 않는다. 같은 sequence에 다른 `messageId`가 오거나 같은 `messageId`에 다른 sequence가 오면 계약 위반으로 기록하고 자동 덮어쓰지 않는다.

### 5.3 pending messages

pending 저장값은 최소한 다음과 같다.

```text
clientMessageId, target/stream identity, content,
createdAtClient, deliveryState, retryCount,
accepted messageId/sequence(확정된 경우)
```

- 새 연결에서 active stream sync가 끝난 뒤 미확정 pending을 같은 `clientMessageId`로 재전송한다.
- accepted 응답은 pending을 확정 message와 연결한다.
- sync 또는 `chat.message.created`가 먼저 온 경우 `messageId`/sequence로 중복을 병합한다.
- accepted와 created의 도착 순서는 보장하지 않는다.
- 명시적 rejected만 failed로 전환한다. 연결 종료만으로 메시지를 failed로 확정하지 않는다.
- 재시도 가능한 pending과 사용자 수정이 필요한 failed를 구분한다.

탭 종료 복구까지 요구하면 pending payload와 cursor를 영속 저장해야 한다. 권장 저장소는 schema version과 actor namespace를 가진 IndexedDB port다. localStorage를 MVP로 선택하면 용량·동기 write·다중 탭 충돌을 명시적으로 수용한다.

### 5.4 active streams

active stream은 “이번 연결 복구에서 자동 sync해야 하는 stream”이다. 단순히 과거에 한 번 방문한 모든 stream으로 정의하지 않는다.

이슈에서 다음 정책을 확정한다.

- 현재 열린 채널/DM/thread와 background 실시간 구독이 필요한 stream만 active로 유지한다.
- UI mount 수가 필요한 경우 ref count를 두되 model 생명주기를 component cleanup과 동일시하지 않는다.
- tab 복원 대상 active stream을 영속화할지, route에서 다시 활성화할지 정한다.
- sync 동시성 상한을 두고 현재 화면 stream을 우선한다.
- 권한이 사라진 stream은 active registry와 영속 cursor에서 제거하거나 접근 불가로 표시한다.
- actor logout 시 해당 actor namespace의 active stream, cursor, pending을 폐기한다.

## 6. 재연결 상태기계와 backoff

권장 연결 상태는 다음과 같다.

```text
idle
→ ticketing
→ connecting
→ connected
→ syncing
→ ready

connected | syncing | ready
→ disconnected
→ waiting_retry
→ ticketing

어느 상태에서든
→ auth_required | stopped
```

상태 전이는 하나의 `ConnectionModel`만 수행한다. socket callback, browser online/offline event, ticket fetch, sync completion은 상태기계에 intent를 전달할 뿐 각자 timer나 socket을 만들지 않는다.

### backoff 권장값

```text
baseDelay = 500ms
cap = 30s
delay = random(0, min(cap, baseDelay * 2^attempt))  // full jitter
```

- browser가 offline이면 timer를 반복 실행하지 않고 `online` event를 기다린다.
- `online`은 즉시 한 번 재시도하되 single-flight를 지킨다.
- 연결이 잠깐 열렸다는 이유만으로 attempt를 0으로 만들지 않는다. sync 완료 뒤 일정 안정 시간까지 유지된 경우 reset한다.
- close code별 분류는 Gateway 공개 계약으로 승격한다.
- `1000` 사용자 의도 종료와 model dispose는 재연결하지 않는다.
- `1001`, `1006`, `1011`, `1013`은 재시도 대상으로 분류하되 `1013`은 서버 과부하 backoff를 지킨다.
- `4401`은 새 ticket으로 제한 횟수 내 즉시 재시도하고 반복되면 `auth_required`/configuration failure로 중단한다.
- timer, fetch, socket에는 attempt generation을 붙여 stale callback이 새 연결을 닫거나 상태를 덮어쓰지 못하게 한다.

## 7. 동기화 순서, 중복 병합, 페이지 처리

### 7.1 연결 복구 순서

1. 새 ticket으로 WebSocket을 연결하고 서버의 application-level connected/ready event를 확인한다.
2. 해당 connection generation에 대한 실시간 `chat.message.created` 수신을 시작하되 sync 중에는 sequence 병합기에 buffer한다.
3. active stream snapshot을 만들고 현재 화면 stream부터 제한된 동시성으로 sync한다.
4. 각 stream에 `afterSequence = contiguousLastSeenSequence`로 첫 페이지를 요청한다.
5. `throughSequence`가 고정된 후속 페이지를 끝까지 받는다.
6. 페이지 메시지와 sync 중 받은 실시간 메시지를 같은 병합기에 넣는다.
7. gap 없이 적용된 cursor를 영속 저장한다.
8. active stream sync가 끝나면 연결 상태를 `ready`로 전환한다.
9. 미확정 pending을 같은 `clientMessageId`로 재전송한다.

전체 stream 하나의 실패가 다른 stream 동기화를 취소하지 않는다. 현재 화면 stream 실패는 UI에 degraded/error 상태로 표시하고 재시도할 수 있게 한다.

### 7.2 병합 불변조건

모든 입력 경로가 하나의 `applyMessage(message, source)`를 사용한다.

```text
source = initial-history | sync-page | realtime-created | accepted-correlation
```

- `messageId`가 이미 있으면 payload 일치 여부를 검증하고 중복 삽입하지 않는다.
- sequence가 cursor 이하이면 이미 적용된 메시지로 처리한다.
- sequence가 cursor + 1이면 적용하고 buffer의 연속 후속 sequence도 drain한다.
- sequence가 cursor + 1보다 크면 buffer하고 gap sync를 예약한다.
- sequence 기준 오름차순이 화면의 canonical ordering이다. 낙관적 pending은 별도 overlay/anchor로 표현한다.
- sync 페이지가 중복되거나 realtime push와 겹쳐도 결과는 한 메시지다.
- cursor와 메시지 persistence는 순서를 보존한다. cursor만 먼저 영속화해 메시지를 잃은 것으로 오인하지 않는다.

### 7.3 페이지 실패와 재개

- 페이지마다 `requestId`, connection generation, stream sync generation을 검증한다.
- timeout 또는 연결 종료 시 받은 페이지까지의 연속 cursor는 보존한다.
- 재연결 후 마지막 연속 cursor에서 새 snapshot sync를 시작해도 안전해야 한다.
- continuation token이 만료되면 해당 stream을 마지막 연속 cursor부터 새 snapshot으로 다시 시작한다.
- page size와 stream 동시성은 설정 가능한 상한을 둔다.
- 응답 message 수, 총 byte, sequence 단조 증가를 runtime에서 검증한다.

## 8. Gateway 세션 종료 의미

Gateway의 socket close는 transport session 종료일 뿐 다음 의미를 갖지 않는다.

- 사용자 logout
- 채널 leave
- active stream 해제
- read cursor 전진
- pending message 실패 확정
- 다른 기기/탭 session 종료

Gateway는 close/error/heartbeat terminate에서 해당 socket의 로컬 session을 정확히 한 번 제거한다. 새 연결은 새 ticket과 새 `sessionId`를 가진 독립 session이다. 이전 Gateway와 새 Gateway가 짧게 겹칠 수 있으므로 client는 connection generation으로 오래된 socket event를 무시하고 message ID/sequence로 중복을 제거한다.

서버 종료의 `1001`, heartbeat의 비정상 종료, ticket 오류의 `4401` 같은 transport 사실은 client 재연결 정책의 입력이다. close reason 문자열은 분기 계약으로 쓰지 않고 close code 또는 versioned application error code를 사용한다.

Gateway는 lastSeenSequence와 pending을 저장하지 않는다. 복구 기준은 API의 저장 메시지와 client의 stream cursor다.

## 9. 예상 패키지와 파일

실제 이름은 Flow 7과 메시지 전송 PR이 만든 계약 경계를 우선한다. 아래는 현재 구조를 기준으로 한 후보다.

```text
packages/realtime-chat-stream-sync-contracts/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  src/index.ts
  test/stream-sync-contract.test.ts

packages/realtime-chat-stream-sync/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  owner-docs/architecture.md
  owner-docs/testing.md
  src/stream-sync-module.ts
  src/stream-sync-table-contract.ts
  src/usecases/sync-stream/sync-stream.usecase.ts
  src/usecases/sync-stream/sync-stream.kysely.ts
  test/sync-stream.test.ts

packages/realtime-chat-domain/src/front/model/
  Emitter.ts
  ConnectionModel.ts
  StreamModel.ts
  PendingOutboundModel.ts
  RealtimeChatSessionModel.ts
  registry.ts
  persistence.ts
  test/connection-model.test.ts
  test/stream-model.test.ts
  test/reconnect-sync.test.ts

apps/realtime-chat-api/
  src/app.ts
  src/runtime/create-runtime-deps.ts
  test/stream-sync-route.test.ts
  public-docs/runtime-contract.md
  owner-docs/runtime-operations.md

apps/realtime-chat-gateway/
  src/app.ts
  src/runtime/realtime-chat-api-client.ts
  test/stream-sync-relay.test.ts
  public-docs/runtime-contract.md
  owner-docs/runtime-operations.md

apps/web/src/features/chat/
  transport/realtimeChatTransport.ts
  transport/gatewayTicketClient.ts
  persistence/indexedDbChatState.ts
  model/useModel.ts
  components/ConnectionStatus.tsx
  components/StreamMessageList.tsx
  components/PendingMessages.tsx
```

`packages/realtime-chat-domain`이 Flow 9만을 위해 새로 만들어지는 것이 과도하면, React가 없는 별도 `packages/realtime-chat-client-model` provider를 선택할 수 있다. 어느 쪽이든 모델 기준 상태를 `apps/web`의 `useState`, context data, 거대한 `useChatRoom` hook에 두지 않는다. package 간에는 workspace package 공개 export만 사용한다.

DB type은 메시지 전송 브랜치의 `MessageSendDatabase`와 Flow 7 query slice를 교차 타입으로 조립하되, stream sync package가 message-send 내부 파일을 deep import하지 않게 public table contract를 확정한다.

## 10. 단계별 구현

### 단계 1. 기준 브랜치와 의존 계약 확정

1. `feat/26-message-send`를 포함한 기준에서 작업한다.
2. Flow 7 이슈의 SyncStream schema, 페이지 의미, read authorization port를 확정한다.
3. `PublicMessage`, `chat.message.created`, `chat.stream.synced`가 공유하는 message DTO를 하나의 공개 package에서 재사용한다.
4. ACK 유실 뒤 pending correlation 정책과 sender용 `clientMessageId` 노출 여부를 결정한다.

### 단계 2. Flow 7 서버 기능 구현 또는 연결

1. stream read authorization을 수행한다.
2. `(stream_id, sequence)` 기반 오름차순 snapshot 페이지 query를 구현한다.
3. 요청/응답 runtime validation과 오류 mapping을 구현한다.
4. API route 또는 내부 command endpoint를 Gateway client에 연결한다.
5. query plan과 PostgreSQL 통합 테스트로 index 사용과 경계값을 검증한다.

### 단계 3. Gateway sync relay

1. 인증 완료 전 `chat.stream.sync`를 거절한다.
2. envelope 크기, version, request ID, stream ID, cursor, limit를 검증한다.
3. actor ID는 local session에서 가져와 API 호출에 주입한다.
4. API 도메인 거절과 timeout/5xx를 다른 client event로 변환한다.
5. socket close 시 진행 중 API 요청을 abort하고 늦은 응답을 전송하지 않는다.

### 단계 4. 클라이언트 모델과 영속 저장소

1. `Emitter`, session/connection/stream/pending submodel과 actor-keyed registry를 만든다.
2. 기존 `useChatRoom`의 메시지·pending 기준 상태를 pure model로 옮긴다.
3. stream 병합기와 연속 cursor 불변조건을 단위 테스트한다.
4. IndexedDB persistence port를 만들고 schema version, actor namespace, migration/clear 정책을 구현한다.
5. React는 `useSyncExternalStore` bridge로 필요한 submodel만 구독한다.

### 단계 5. 실제 transport와 재연결 상태기계

1. ticket HTTP client와 WebSocket transport를 구현한다.
2. connection attempt generation, single-flight, abort, close code 분류를 구현한다.
3. full-jitter exponential backoff와 browser online/offline 연동을 구현한다.
4. 새 socket에서 application-level connected 확인 후 active stream sync를 시작한다.
5. 명시적 stop/logout과 일시적 disconnect를 분리한다.

### 단계 6. active stream 동기화와 pending 복구

1. 현재 화면 우선순위와 sync 동시성 상한으로 active stream snapshot을 처리한다.
2. snapshot watermark를 유지해 모든 페이지를 가져온다.
3. sync 중 realtime push를 buffer하고 동일 병합기로 적용한다.
4. 완료 cursor를 영속화하고 stream별 상태를 ready/degraded로 갱신한다.
5. 미확정 pending을 같은 `clientMessageId`로 재전송해 accepted/rejected를 복구한다.

### 단계 7. 생명주기·운영 문서·통합 검증

1. component unmount가 socket/model을 dispose하지 않도록 registry 생명주기를 연결한다.
2. logout 또는 domain session 종료에서만 socket, timer, browser listener, persistence를 정리한다.
3. close code, sync envelope, page limit, backoff 설정과 관측 필드를 public/owner docs에 반영한다.
4. 실제 API, Gateway, Web client로 강제 단절과 누락 복구 시나리오를 검증한다.

## 11. 테스트 계획

### 서버 계약·쿼리 테스트

- `afterSequence=0`, stream head와 같은 cursor, head보다 큰 cursor의 결과를 검증한다.
- 메시지는 sequence 오름차순이며 page 사이에 중복과 누락이 없다.
- 첫 page 이후 새 메시지가 저장돼도 고정 `throughSequence` snapshot은 유한하게 끝난다.
- continuation token 위조·만료, 잘못된 limit, 음수·소수 cursor를 거절한다.
- 다른 actor의 private stream read를 거절한다.
- DB index와 페이지 상한을 PostgreSQL 통합 테스트로 검증한다.

### Gateway 테스트

- 인증되지 않은 socket의 sync를 거절한다.
- client가 actorId를 보내도 session actor로 덮어쓰거나 strict schema로 거절한다.
- API 결과를 `requestId`가 보존된 `chat.stream.synced`로 relay한다.
- socket close 시 진행 중 sync 요청을 abort하고 세션을 제거한다.
- 늦은 API 응답을 새 socket에 보내지 않는다.
- 정상 close, heartbeat terminate, drain close에서 세션 제거가 멱등이다.

### 클라이언트 모델 테스트

- cursor 10에서 12를 먼저 받으면 cursor를 10에 두고, 11 이후 12까지 전진한다.
- sync page와 realtime push에 같은 message가 있어도 한 번만 나타난다.
- 같은 sequence의 다른 message ID를 계약 위반으로 처리한다.
- 여러 page 실패 후 마지막 연속 cursor부터 안전하게 재개한다.
- accepted-before-created와 created-before-accepted를 모두 병합한다.
- ACK 유실 뒤 같은 `clientMessageId` 재시도로 pending을 기존 message에 연결한다.
- 연결 종료만으로 pending을 failed로 바꾸지 않는다.
- actor logout 시 다른 actor 데이터와 섞이지 않게 persistence를 정리한다.

### 상태기계 테스트

- 동시에 여러 reconnect trigger가 와도 ticket 요청과 socket은 하나뿐이다.
- 이전 attempt의 ticket/socket callback이 현재 세대 상태를 바꾸지 않는다.
- 재시도 가능한 오류는 full-jitter 범위와 cap을 지킨다.
- browser offline 동안 재시도하지 않고 online 시 재개한다.
- `4401`은 ticket을 재사용하지 않고 새 ticket을 발급한다.
- `401/403`과 명시적 stop은 자동 재시도하지 않는다.
- 안정적인 ready 이전 반복 단절은 backoff attempt를 섣불리 reset하지 않는다.

### 앱·브라우저 통합 테스트

- 메시지 sequence 10까지 본 뒤 Gateway를 끊고 11~13을 저장한 다음 재접속하면 11~13이 순서대로 복구된다.
- 재접속 중 sequence 14 실시간 push가 먼저 와도 최종 결과는 11~14 한 번씩이다.
- 첫 ticket을 소비한 뒤 같은 ticket 연결은 실패하고 새 ticket 연결은 성공한다.
- 두 active stream이 서로 다른 페이지 수와 오류를 가져도 독립적으로 복구된다.
- 새로고침/탭 복원 뒤 cursor와 pending이 actor namespace에서 복원된다.
- route 이동과 remount가 socket/model을 중복 생성하거나 메시지 history를 초기화하지 않는다.
- 연결 상태 변경이 메시지 목록 전체를 불필요하게 다시 렌더링하지 않고, 반대도 동일하다.

## 12. 관측성

구조화 로그와 metric에 다음 정보를 사용한다.

```text
connectionAttemptId, connectionGeneration, gatewayId,
closeCode, reconnectReason, retryAttempt, retryDelayMs,
streamId, syncRequestId, afterSequence, throughSequence,
pageCount, messageCount, gapDetected, durationMs
```

ticket 원문, message content, pending content, 인증 헤더는 기록하지 않는다.

관측할 지표 후보는 다음과 같다.

- ticket 발급·WebSocket 연결 성공/실패와 단계별 지연
- close code별 종료 수와 reconnect attempt 분포
- ready까지 걸린 시간과 active stream sync 시간
- sync page 수, 복구 message 수, gap 감지 수
- pending 재전송·accepted·rejected 수
- stale generation 응답 폐기 수
- IndexedDB 복원·migration·오류 수

## 13. 완료 조건

- 모든 자동 재연결 시도는 새 일회성 ticket을 사용하고 ticket을 영속 저장하지 않는다.
- 상태기계가 single-flight, generation 취소, 오류 분류, full-jitter backoff를 테스트로 보장한다.
- Flow 7 SyncStream이 read authorization, 오름차순 snapshot pagination, 페이지 상한을 제공한다.
- Gateway가 session actor를 사용해 sync를 relay하고 close 시 진행 요청과 로컬 세션을 정리한다.
- stream cursor가 최대 관찰 sequence가 아니라 최대 연속 적용 sequence로만 전진한다.
- sync page, realtime push, accepted 결과가 하나의 병합 규칙을 사용해 중복·역순을 안전하게 처리한다.
- 여러 페이지와 sync 중 신규 push가 있어도 유한하게 catch-up하고 누락이 없다.
- pending은 같은 `clientMessageId`로 복구되며 연결 종료만으로 실패 확정되지 않는다.
- lastSeenSequence, pending, active stream의 persistence와 actor/logout 경계가 정해져 있다.
- client model은 React 밖에 있고 component는 필요한 submodel만 `useSyncExternalStore`로 구독한다.
- route unmount가 model/socket을 종료하지 않고 domain stop/logout만 dispose한다.
- 계약·단위·PostgreSQL·Gateway·브라우저 통합 테스트와 관련 build/typecheck가 통과한다.
- 확정된 계약은 provider README/public docs에, 내부 결정은 owner docs에 반영된다.
- 이 `notes/implementation-plans` 경로는 AGENTS context route에 포함되지 않는다.

## 14. 비범위

- 메시지 전송·sequence 발급·`clientMessageId` 서버 멱등성 자체의 재구현
- Flow 6 브로커 fan-out 구현
- read cursor와 unread 계산
- presence의 online/offline 의미
- DM/thread/system message별 active stream 정책 확장
- service worker 기반 background sync와 OS push notification
- 여러 브라우저 탭 사이 하나의 WebSocket을 공유하는 SharedWorker/BroadcastChannel 최적화
- 무제한 전체 history 초기 적재. 초기 화면용 tail/history pagination은 별도 정책이다.
- exactly-once socket delivery 보장

## 15. 위험과 미결정

| 항목 | 위험 | 이슈 시작 시 결정/완화 |
| --- | --- | --- |
| Flow 7 선행성 | SyncStream 없이 reconnect만 구현하면 누락 복구 불가 | Flow 7 contract/구현을 선행 또는 같은 이슈의 명시적 첫 단계로 둠 |
| `clientMessageId` 부재 | ACK 유실 뒤 sync message와 pending 직접 연결 불가 | 같은 ID 재전송으로 accepted 복구, sender correlation 필드 필요성 결정 |
| snapshot 없는 pagination | 쓰기가 계속되면 sync가 끝나지 않거나 page 경계가 흔들림 | `throughSequence` 또는 opaque snapshot token 고정 |
| cursor 의미 | 관찰 최대값을 저장하면 중간 gap을 영구 누락 | 최대 연속 적용 sequence만 cursor로 정의 |
| 초기 cursor 0 | 큰 stream 전체를 자동 적재할 수 있음 | 최초 진입 tail/history 계약과 reconnect sync를 분리 |
| active stream 정의 | 방문한 모든 stream sync로 부하 폭증 | 현재 활성/구독 stream만, 동시성 상한과 우선순위 적용 |
| React 생명주기 | route 이동마다 socket 종료·재생성 | actor/workspace model registry가 resource 소유 |
| 다중 탭 | 탭마다 socket, cursor, IndexedDB write가 경쟁 | MVP 허용 여부와 storage conflict 규칙 결정, 최적화는 별도 이슈 |
| stale callback | 이전 socket/HTTP 응답이 새 상태를 덮음 | connection/sync generation 검증과 abort |
| flap | open 직후 attempt reset으로 빠른 무한 재연결 | sync 완료와 안정 시간 후 reset |
| pending 자동 재전송 | 사용자가 원하지 않은 늦은 전송처럼 보일 수 있음 | 재시도 가능 상태, 보존 기간, UI 표시와 취소 기능 확정 |
| 영속 데이터 보안 | 공용 기기에서 message/pending 노출 | actor namespace, logout clear, 보존 기간, 민감 content 저장 정책 |
| 권한 변경 | reconnect 사이 stream 접근권이 사라짐 | API read authorization, client active registry 정리 |
| protocol rolling deploy | 구·신 sync pagination 계약 불일치 | version 필드와 additive 호환 정책 |
| close code 의존 | reason 문자열/프록시가 코드를 바꿀 수 있음 | 공개 close code 계약, unknown은 보수적 재시도 분류 |
| 서버 clock | reconnect와 메시지 정렬을 시간으로 하면 오순서 | 정렬과 cursor는 stream sequence만 사용 |

## 16. 문서 경계 결과

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 계획 기록이다.
- 현재 소비자가 읽는 공개 파일은 기존 앱의 `README.md`와 `public-docs/runtime-contract.md`이며 Flow 9 계약은 아직 없다.
- 구현 시 계약 소비자는 stream-sync/message provider의 `README.md`와 `public-docs/*`만 읽는다.
- 소비자에서 deny할 경로는 provider의 `AGENTS.md`, `owner-docs/`, `notes/`다.
- owner는 provider `AGENTS.md`가 안내하는 `owner-docs/*`를 읽는다.
- React Model Render 적용 결과, 확정될 client model은 React 밖 package에 두고 React glue만 `apps/web`에 둔다.
- 이 계획을 포함한 `notes/`는 agent route에 넣지 않는다.
- parent directory deny 뒤 child public docs를 다시 여는 permission 패턴은 사용하지 않는다.
