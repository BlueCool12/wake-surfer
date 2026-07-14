# Flow 07 — Outbound publish 실패와 afterSequence 복구 구현 계획

> **주의:** 이 문서는 현재 구현 계약이 아니라 GitHub 이슈 작성과 작업 브랜치 분리를 위한 사람용 구현 계획이다. 확정된 외부 계약은 각 provider의 `README.md`와 `public-docs/`에 별도로 반영해야 하며, 이 문서를 에이전트 기본 문맥이나 소비자 계약으로 사용하지 않는다.

## 1. 목적과 범위

메시지 저장은 성공했지만 `OutboundMessageDeliveryRequested` publish가 실패하거나 실시간 push가 누락된 경우, 수신자가 stream별 sequence cursor로 저장된 메시지를 다시 가져와 화면을 복구할 수 있게 한다.

이 Flow에서 보장할 결과는 다음과 같다.

- delivery publish 실패가 저장된 메시지와 송신자 accepted를 롤백하지 않는다.
- publish 실패는 구조화된 로그와 지표로 관측할 수 있다.
- 읽기 권한이 있는 사용자는 `afterSequence` 이후 메시지를 오름차순으로 제한된 개수만 조회한다.
- 여러 페이지를 조회하는 동안 기준 상한을 고정해 누락 없이 한 시점의 stream 상태까지 수렴한다.
- 클라이언트는 재접속, 화면 진입, sequence gap 감지 시 sync를 실행한다.
- 실시간 event와 sync 결과가 겹쳐도 `messageId`로 중복 표시하지 않고 sequence 기준으로 한 상태에 수렴한다.

이 Flow는 실시간 fan-out 자체, 메시지 쓰기 본체, 재접속 티켓 처리, read cursor를 구현하지 않는다.

## 2. 현재 상태

현재 작업트리에는 Gateway Ticket과 WebSocket 접속 인증까지만 실제 백엔드 런타임에 연결돼 있다.

- `apps/realtime-chat-api`에는 메시지 조회 endpoint가 없다.
- `apps/realtime-chat-gateway`에는 `chat.stream.sync` event handler와 메시지 push가 없다.
- `apps/web`의 `loadHistory()`는 목 배열 전체를 반환하며 cursor, 페이지 제한, 권한 오류를 표현하지 않는다.
- 공통 DB 타입에는 현재 Gateway Ticket 테이블만 들어 있다.

브랜치 전환 없이 확인한 로컬 `feat/26-message-send`에는 Flow 7의 기반이 될 다음 구현이 있다.

- `message_streams(stream_id, last_sequence)`
- `messages(stream_id, sequence, ...)`
- `UNIQUE (stream_id, sequence)`
- `messages_stream_sequence_idx (stream_id, sequence)`
- 저장된 `PublicMessage` 계약
- `OutboundMessageDeliveryRequested(eventId, occurredAt, message, recipientActorIds)` 계약
- 저장 transaction commit 뒤 best-effort publisher 호출
- publisher가 throw해도 예외를 삼키고 accepted를 반환하는 동작

하지만 다음은 아직 없다.

- publish 실패를 기록하는 observer 또는 logger 경계
- publisher 제한시간과 실패 원인 분류
- stream 읽기 권한 포트
- `SyncStream` 요청/응답 계약과 runtime schema
- `afterSequence` 범위 조회 use case
- 페이지 상한과 연속성 검증
- API/Gateway/WebSocket 연결
- 실제 PostgreSQL 조회 통합 테스트
- publish 실패부터 sync 복구까지의 E2E 테스트

## 3. Flow 5와 Flow 6 의존성

### Flow 5 — ACK 유실 후 멱등 재시도

Flow 5는 다음 불변조건을 먼저 제공해야 한다.

- 저장된 메시지가 `(senderActorId, streamId, clientMessageId)`로 중복 생성되지 않는다.
- 중복 send는 기존 accepted를 반환하며 delivery를 다시 publish하지 않는다.
- sequence는 stream 안에서 한 번만 증가한다.

Flow 7은 send 재시도를 delivery 복구 수단으로 사용하지 않는다. 최초 publish가 실패한 뒤 같은 메시지를 재시도해도 publish를 다시 하지 않으므로, `afterSequence` sync가 독립적인 복구 경로여야 한다.

### Flow 6 — 실시간 배달 fan-out

Flow 6는 다음 경계를 제공해야 한다.

- 메시지 저장 패키지가 호출할 `OutboundDeliveryPublisher` 구현
- publish 성공 시 각 Gateway가 받아 로컬 수신자 session에 `chat.message.created`를 보내는 경로
- publisher가 실패를 throw하거나 명시적 실패 결과로 알려주는 계약
- Gateway가 동일 delivery event를 여러 번 받아도 `eventId` 또는 `messageId`로 안전하게 처리할 수 있는 기준

stream sync use case와 DB 조회는 Flow 6 완성 전에 독립 구현할 수 있다. 다만 “publish 실패 → 수신자 push 없음 → sync로 복구” 전체 E2E 완료 판정은 Flow 6의 publisher/fan-out 경계가 있어야 한다.

## 4. 책임 경계

### 메시지 전송 provider

- message commit과 accepted 결과를 소유한다.
- 최초 생성 결과에 대해서만 delivery publish를 시도한다.
- publish 실패를 저장 실패로 바꾸지 않는다.
- publish 실패 observer에 message/event 식별자와 오류를 전달한다.
- stream sync 조회는 소유하지 않는다.

### stream sync provider

- `SyncStream` command와 조회 정책을 소유한다.
- actor가 stream을 읽을 수 있는지 권한 포트를 통해 확인한다.
- snapshot 상한과 페이지 cursor를 검증한다.
- 메시지를 `sequence ASC`로 반환한다.
- 읽기 작업만 수행하며 read cursor를 갱신하지 않는다.

별도 `@wake-surfer/realtime-chat-stream-sync` 패키지를 권장한다. 메시지 전송 패키지의 공개 `table-contract`와 메시지 DTO 계약에 의존해 같은 테이블을 읽되, 쓰기 트랜잭션과 조회 변경 이유를 한 패키지에 섞지 않는다.

### API 앱

- 인증된 Gateway 또는 HTTP actor 문맥을 주입한다.
- actor 식별자를 요청 본문에서 받지 않는다.
- sync provider를 호출하고 timeout, 오류 응답, 로그를 runtime 계약에 맞게 변환한다.
- 메시지 content나 권한 정책을 앱 내부에서 재구현하지 않는다.

### Gateway

- WebSocket event의 JSON, 크기, 필수 필드, 정수 범위를 검증한다.
- session의 actor로 내부 API를 호출한다.
- API의 sync 결과를 `chat.stream.synced`로 relay한다.
- 읽기 권한을 로컬 session 정보로 추측하지 않는다.

### 웹 클라이언트

- stream별 `lastSeenSequence`를 유지한다.
- 화면 진입, 재접속, sequence gap 감지 시 sync를 시작한다.
- 페이지를 순차 요청하고 연속된 sequence만 cursor에 반영한다.
- 실시간 `created`와 sync 메시지를 `messageId`로 병합한다.

## 5. 저장 성공과 publish 실패의 의미

`chat.message.accepted`는 다음을 뜻한다.

```text
권한과 content 검증 성공
+ message transaction commit 성공
+ stream sequence 발급 성공
```

다음을 뜻하지 않는다.

```text
OutboundEventBus publish 성공
수신 Gateway 수신 성공
수신 socket write 성공
상대 클라이언트 렌더링 성공
```

publish가 실패해도 message row와 `last_sequence`는 유지한다. sender에게는 accepted를 반환한다. publish 오류를 client rejected로 바꾸거나 message transaction을 보상 삭제하지 않는다.

현재 메시지 전송 브랜치는 publisher를 `await`한 뒤 오류를 삼키므로 결과 의미는 분리돼 있지만 ACK 지연 시간은 publisher 지연에 묶여 있다. MVP에서는 publisher에 짧고 명시적인 제한시간을 적용한 bounded best-effort를 권장한다. 제한시간 또는 실패 후 accepted를 반환하되, 프로세스 종료 시 유실될 수 있는 무관리 background promise로 바꾸지 않는다.

문서의 “ACK 후 publish”는 의미적 순서로 해석한다. 실제 HTTP 응답의 wire 전송 전에 bounded publish 시도를 마칠 수 있으며, 외부 계약은 publish 결과와 무관한 accepted라는 점만 보장한다.

## 6. SyncStream 계약

### 요청

transport-neutral command의 권장 형태는 다음과 같다.

```ts
type SyncStreamRequest = {
  commandId?: string;
  streamId: string;
  afterSequence: number;
  limit?: number;
  syncUpperBound?: number;
};
```

- `streamId`: 서버가 발급한 stream 식별자다.
- `afterSequence`: 클라이언트가 연속적으로 반영 완료한 마지막 sequence다. 최초 조회는 `0`이다.
- `limit`: 기본 `50`, 최대 `100`을 제안한다. 서버가 상한을 강제한다.
- `syncUpperBound`: 첫 페이지 응답에서 서버가 고정한 snapshot 상한이다. 후속 페이지에서 그대로 보낸다.
- actor는 Gateway session 또는 HTTP 인증 문맥에서 주입하며 body에 포함하지 않는다.

입력 schema는 다음을 강제한다.

- `streamId`는 공백이 아니며 길이 제한이 있다.
- `afterSequence`는 0 이상의 안전한 정수다.
- `limit`는 1 이상 서버 최대값 이하의 정수다.
- `syncUpperBound`는 제공 시 0 이상의 안전한 정수이며 `afterSequence <= syncUpperBound`다.
- strict object로 예상하지 못한 actor/권한 관련 필드를 거절한다.

### 성공 응답

```ts
type SyncStreamAccepted = {
  status: "synced";
  commandId?: string;
  streamId: string;
  requestedAfterSequence: number;
  syncUpperBound: number;
  messages: PublicMessage[];
  nextAfterSequence: number;
  hasMore: boolean;
};
```

- 메시지는 `(streamId, sequence)` 기준 오름차순이다.
- `nextAfterSequence`는 이번 페이지에서 연속적으로 반환한 마지막 sequence다. 빈 페이지면 요청의 `afterSequence`다.
- `hasMore`는 `nextAfterSequence < syncUpperBound`인 경우 true다.
- 첫 페이지의 `syncUpperBound`는 조회 시작 시 `message_streams.last_sequence`다.
- 후속 페이지는 같은 `syncUpperBound` 이하만 조회한다. 조회 도중 새 메시지가 생겨도 현재 sync 범위가 움직이지 않는다.

### 거절 응답

내부 결과는 최소한 다음을 구분할 수 있어야 한다.

```ts
type SyncStreamRejectedReason =
  | "stream_unavailable"
  | "invalid_cursor"
  | "history_gap";
```

- 존재하지 않는 stream과 읽기 권한이 없는 stream은 외부에 동일한 `stream_unavailable`로 노출해 존재 여부 탐색을 막는다.
- `afterSequence`가 현재 stream head보다 앞서 있는 것이 아니라 **더 큰 경우** `invalid_cursor`로 거절한다.
- 현재 보존 정책에서 존재해야 할 sequence가 조회되지 않으면 `history_gap`으로 기록하고 거절한다. MVP에 hard delete/retention이 없다면 이는 데이터 불변조건 위반이다.

WebSocket event 이름은 `chat.stream.sync`, `chat.stream.synced`, `chat.stream.sync.rejected`를 권장한다. HTTP history endpoint를 함께 제공하더라도 동일 sync provider와 DTO를 사용하고 별도 조회 의미를 만들지 않는다.

## 7. 권한과 정보 노출 방지

권한 검증은 메시지 조회 전에 API의 `StreamReadAuthorizer`에서 수행한다.

```ts
type StreamReadAuthorizer = (input: {
  actorId: string;
  streamId: string;
}) => Promise<{ status: "allowed" } | { status: "denied" }>;
```

- Gateway는 session 존재만 확인하고 membership을 판단하지 않는다.
- channel은 workspace/channel membership과 archived/read policy를 확인한다.
- DM은 참여자인지 확인한다.
- thread는 원본 stream 접근 권한을 확인한다.
- 거절 응답에 stream의 target type, owner, last sequence, 메시지 수를 포함하지 않는다.
- 로그에는 actor/stream 식별자를 넣을 수 있지만 message content는 넣지 않는다.

초기 구현의 기본 authorizer가 무조건 허용하도록 두지 않는다. 실제 권한 provider가 준비되지 않았다면 runtime 조립을 실패시키거나 테스트 전용 adapter를 명시적으로 주입한다.

## 8. 페이지 처리와 연속성

페이지 조회는 offset이 아니라 sequence cursor를 사용한다.

첫 페이지 처리:

1. stream 존재 확인과 읽기 권한 검증
2. 짧은 read transaction 시작
3. `message_streams.last_sequence`를 `syncUpperBound`로 읽기
4. `afterSequence <= syncUpperBound` 검증
5. `afterSequence < sequence <= syncUpperBound` 범위 조회
6. 최대 `limit`건을 `sequence ASC`로 반환

후속 페이지는 클라이언트가 이전 응답의 `nextAfterSequence`와 같은 `syncUpperBound`를 보낸다. 서버는 전달받은 상한이 현재 stream head보다 크지 않은지 검증하고 같은 범위 안에서 계속 읽는다.

클라이언트는 다음 규칙을 지킨다.

- sequence가 `lastSeenSequence + 1`로 이어지는 메시지만 연속 반영한다.
- 실시간 event가 먼저 도착해 간격이 생기면 해당 message를 임시 보관하고 마지막 연속 cursor 이후를 sync한다.
- 페이지 메시지와 실시간 메시지는 `messageId`로 중복 제거한다.
- `hasMore`가 true면 같은 `syncUpperBound`로 다음 페이지를 요청한다.
- final page를 반영한 뒤 `lastSeenSequence = syncUpperBound`로 수렴한다.
- sync 완료 후 도착한 sequence는 다음 실시간 처리 또는 다음 sync 범위에서 다룬다.

무한 루프를 막기 위해 한 번의 사용자 동작에서 최대 페이지 수 또는 최대 복구 메시지 수를 둔다. 초과 시 전체 history를 한 번에 내려주지 말고 “추가 동기화 필요” 상태로 남긴다.

## 9. 예상 패키지와 파일

실제 이름은 선행 PR 머지 후 다시 확인한다.

### 신규 계약 provider

```text
packages/realtime-chat-stream-sync-contracts/
  README.md
  package.json
  src/index.ts
  test/stream-sync-contract.test.ts
```

- request/response DTO, runtime schema, 공개 rejected reason을 소유한다.
- `PublicMessage`를 중복 정의하지 않고 메시지 계약 provider에서 가져오거나 향후 공통 공개 message DTO provider로 승격한다.

### 신규 sync provider

```text
packages/realtime-chat-stream-sync/
  README.md
  package.json
  src/index.ts
  src/stream-sync-module.ts
  src/usecases/sync-stream/sync-stream.usecase.ts
  src/usecases/sync-stream/sync-stream.kysely.ts
  test/stream-sync-usecase-invariants.test.ts
  test/stream-sync-postgres.integration.test.ts
```

- 메시지 전송 provider의 `./table-contract` 공개 경계 또는 필요한 최소 DB table contract에 의존한다.
- 신규 테이블은 만들지 않는다.

### 메시지 전송 provider 보강

- `packages/realtime-chat-message-send/src/message-send-module.ts`
- `packages/realtime-chat-message-send/src/usecases/send-message/send-message.usecase.ts`
- `packages/realtime-chat-message-send/test/message-send-usecase-invariants.test.ts`
- `packages/realtime-chat-message-send/README.md`

publisher timeout과 `DeliveryPublishFailureObserver` 경계를 추가한다. logger를 도메인 패키지에 직접 import하지 않는다.

### DB와 앱 조립

- `packages/realtime-chat-database/src/realtime-chat-database.ts`: sync module이 필요한 DB 타입 조립만 추가하고 migration은 추가하지 않는다.
- `apps/realtime-chat-api/src/app.ts`
- `apps/realtime-chat-api/src/runtime/create-runtime-deps.ts`
- `apps/realtime-chat-api/test/app-smoke.test.ts`
- `apps/realtime-chat-api/public-docs/runtime-contract.md`
- `apps/realtime-chat-gateway/src/app.ts` 또는 분리된 message handler 파일
- `apps/realtime-chat-gateway/src/runtime/realtime-chat-api-client.ts`
- `apps/realtime-chat-gateway/test/realtime-chat-api-client.test.ts`
- `apps/realtime-chat-gateway/test/app-smoke.test.ts`
- `apps/realtime-chat-gateway/public-docs/runtime-contract.md`

Gateway 앱이 더 커지면 WebSocket event 해석과 sync relay를 `packages/realtime-chat-gateway` slice로 내리는 선행/동반 리팩터링을 검토한다.

### 웹 클라이언트

- `apps/web/src/features/chat/contracts.ts`: 임시 미러 제거
- `apps/web/src/features/chat/transport/chatTransport.ts`
- 실제 WebSocket transport 파일
- `apps/web/src/features/chat/useChatRoom.ts`
- stream sync와 event 병합 model/test 파일

`loadHistory(): Promise<PublicMessageDto[]>` 전체 반환 계약은 paged sync 계약으로 교체한다.

## 10. 예상 DB 조회

기존 인덱스 `messages_stream_sequence_idx (stream_id, sequence)`를 그대로 활용한다.

개념 SQL은 다음과 같다.

```sql
SELECT last_sequence
FROM message_streams
WHERE stream_id = :streamId;

SELECT message_id,
       stream_id,
       sequence,
       sender_actor_id,
       target_type,
       target_id,
       content_type,
       content_text,
       sent_at_client,
       created_at
FROM messages
WHERE stream_id = :streamId
  AND sequence > :afterSequence
  AND sequence <= :syncUpperBound
ORDER BY sequence ASC
LIMIT :limit;
```

권한 검증에 필요한 membership query는 sync 패키지에 임시로 복제하지 않고 권한 provider가 소유한다. 메시지 content를 조회한 뒤 권한을 거절하는 순서를 피한다.

첫 페이지에서 head와 message rows의 일관된 snapshot이 필요하면 짧은 read-only transaction을 사용한다. 메시지 write transaction이 `last_sequence` 증가와 insert를 함께 commit하므로 read committed에서도 commit된 head에 대응하는 rows가 보여야 하지만, 실제 PostgreSQL 통합 테스트로 확인한다.

## 11. 단계별 구현

1. Flow 5 메시지 멱등성과 Flow 6 publisher 계약의 머지 결과를 확인한다.
2. `stream-sync-contracts`에 request/response schema, pagination, rejection semantics를 정의한다.
3. `stream-sync` 패키지에 권한 포트와 transport-neutral use case를 만든다.
4. Kysely query로 snapshot 상한과 sequence 범위를 읽고 DB row를 `PublicMessage`로 엄격하게 변환한다.
5. 실제 PostgreSQL 통합 테스트로 인덱스 사용, 정렬, 상한 고정, 동시 append 시나리오를 검증한다.
6. 메시지 전송 publisher에 bounded timeout과 실패 observer를 추가한다.
7. API runtime에서 observer를 구조화 로그·metric adapter에 연결하고 sync endpoint를 조립한다.
8. Gateway에서 `chat.stream.sync`를 검증해 내부 API로 relay하고 accepted/rejected event를 내려준다.
9. 웹 transport와 상태 model이 cursor, 페이지, 실시간 event 병합을 처리하도록 바꾼다.
10. publish 실패를 강제한 E2E 시나리오로 sender accepted와 receiver sync 복구를 함께 검증한다.
11. 확정된 계약만 각 provider의 `README.md`/`public-docs`와 owner 테스트 문서에 승격한다.

## 12. 실패 기록과 관측성

현재처럼 빈 `catch`로 끝내지 않는다. 메시지 전송 provider는 다음 형태의 observer port를 호출한다.

```ts
type DeliveryPublishFailureObserver = (input: {
  eventId: string;
  messageId: string;
  streamId: string;
  sequence: number;
  recipientCount: number;
  reason: "timeout" | "publisher_error";
  error: unknown;
}) => void | Promise<void>;
```

observer 자체가 실패해도 accepted를 깨지 않도록 보호한다. runtime adapter는 다음을 남긴다.

- 구조화 경고 로그: `requestId`, `eventId`, `messageId`, `streamId`, `sequence`, `recipientCount`, 오류 종류
- counter: publish 시도, 성공, 실패, timeout
- histogram: publish 소요 시간
- sync counter: 요청, 성공, 거절 reason, 조회 메시지 수, 페이지 수
- recovery latency를 측정할 수 있다면 publish 실패 시각부터 해당 sequence sync 시각까지의 분포

metric label에 `streamId`, `messageId`, `actorId` 같은 고카디널리티 값을 넣지 않는다. message content, ticket, 전체 recipient 목록도 로그에 남기지 않는다.

publisher가 설정되지 않은 상태는 publish 실패와 다르다. 테스트에서는 선택 의존성을 허용할 수 있지만, delivery가 활성화돼야 하는 배포 환경에서 publisher 미설정은 readiness 실패 또는 시작 실패로 처리한다.

## 13. 테스트 계획

### 단위 테스트

- 읽기 권한 거절 시 message query를 실행하지 않는다.
- 존재하지 않는 stream과 권한 거절의 외부 reason이 동일하다.
- `afterSequence=0`부터 첫 페이지를 읽는다.
- limit 기본값과 최대값을 강제한다.
- 반환 메시지는 sequence 오름차순이다.
- 기존 `syncUpperBound`가 있으면 그 이후에 생성된 메시지를 현재 page에 포함하지 않는다.
- cursor가 head보다 크면 `invalid_cursor`다.
- sequence gap을 발견하면 `history_gap`이다.
- publish throw/timeout 후에도 send 결과는 accepted다.
- publish 실패 observer가 정확히 한 번 호출된다.
- observer 자체 실패도 accepted를 깨지 않는다.

### PostgreSQL 통합 테스트

- stream에 sequence 1~N을 저장하고 `afterSequence` 범위와 limit이 정확하다.
- 여러 stream의 같은 sequence가 섞이지 않는다.
- 첫 page 후 새 메시지를 append해도 고정된 `syncUpperBound` 페이지에는 들어오지 않는다.
- 다음 새 sync에서는 이전 상한 이후 메시지를 가져온다.
- 동시 append 중 읽기가 미커밋 row를 보지 않고 commit 후 누락 없이 조회한다.
- 기존 `(stream_id, sequence)` 인덱스가 범위 조회에 사용 가능한 query shape인지 `EXPLAIN` 또는 충분한 fixture 성능 테스트로 확인한다.
- 권한 거절 시 DB message row/content가 조회되지 않는다.

### API/Gateway 통합 테스트

- actor는 session/auth context에서 주입되고 body의 actor 필드는 거절된다.
- Gateway가 `streamId`, `afterSequence`, `limit`, `syncUpperBound`를 의미 변경 없이 전달한다.
- malformed JSON, 음수/소수 cursor, 과도한 limit을 경계에서 거절한다.
- API timeout/5xx가 정상 `chat.stream.synced`로 위장되지 않는다.
- sync rejected가 stream 정보 누출 없이 relay된다.

### 웹 상태 테스트

- 화면 진입 시 `afterSequence=0` 또는 저장된 cursor로 sync한다.
- sequence gap 감지 시 마지막 연속 sequence부터 sync한다.
- `created`와 sync 결과에 같은 `messageId`가 있어도 한 번만 렌더링한다.
- page 사이에 live event가 들어와도 순서와 cursor가 깨지지 않는다.
- `hasMore`가 true인 동안 같은 상한으로 다음 page를 요청한다.
- page 또는 연결 실패 후 마지막 성공 cursor부터 안전하게 재개한다.

### E2E 테스트

1. 송신자와 수신자를 서로 다른 Gateway session으로 연결한다.
2. publisher를 실패하도록 설정한다.
3. 송신자는 `chat.message.accepted`를 받는다.
4. 수신자는 `chat.message.created`를 받지 못한다.
5. 수신자가 이전 sequence로 `chat.stream.sync`를 호출한다.
6. 저장된 메시지를 `chat.stream.synced`에서 받고 UI에 한 번 표시한다.
7. publish 실패 로그와 metric이 생성됐는지 확인한다.

## 14. 완료 조건

- publish 실패 후에도 message와 stream sequence가 DB에 남고 sender accepted가 유지된다.
- publish 실패가 빈 catch로 사라지지 않고 구조화 로그와 metric으로 관측된다.
- 읽기 권한이 없는 actor는 메시지 존재 여부와 stream head를 알 수 없다.
- `afterSequence` 조회가 오름차순, page limit, snapshot 상한을 지킨다.
- 여러 page와 동시 새 메시지 상황에서도 클라이언트가 고정 상한까지 수렴한다.
- 실시간 event와 sync 결과가 겹쳐도 메시지가 중복 표시되지 않는다.
- 실제 PostgreSQL 통합 테스트와 publish 실패 E2E 테스트가 통과한다.
- 확정된 외부 계약이 provider 공개 문서에 반영되고 이 계획 `notes`는 agent route에 포함되지 않는다.

## 15. 비범위

- Flow 6의 broker 선택과 전체 fan-out 구현
- socket delivery의 exactly-once 보장
- sender ACK 유실 재시도 구현
- read cursor 및 unread count 갱신
- 메시지 편집·삭제·retention 정책
- 전체 과거 history 무제한 다운로드
- 여러 stream을 한 요청으로 동기화하는 batch protocol
- 브라우저 영구 저장소에 cursor를 보존하는 상세 구현
- 이 이슈에서 Outbox Pattern 도입

## 16. Outbox 도입 기준

MVP는 “DB 저장 성공 + publish 실패 가능 + sync 복구”를 허용한다. 다음 조건 중 하나 이상이 운영 요구사항이 되면 transactional outbox 이슈를 연다.

- 실시간 전달 성공률 또는 복구 지연 SLO를 afterSequence sync만으로 만족하지 못한다.
- 사용자가 화면 재진입/재접속을 하지 않아도 누락 event를 서버가 자동 재전달해야 한다.
- 메시지 event를 소비하는 projection이나 외부 시스템이 늘어나 durable replay가 필요하다.
- publish 실패율과 복구 지연이 사용자 체감 장애 수준으로 반복된다.
- 프로세스 crash, 배포, broker 장애 구간의 미발행 event를 운영자가 재처리해야 한다.
- 장애 분석 시 “어떤 메시지가 publish되지 않았는가”를 로그 추정이 아니라 durable 상태로 조회해야 한다.

Outbox를 도입하면 다음 조건을 함께 보장한다.

- message insert와 outbox insert는 같은 DB transaction이다.
- Flow 5 중복 send는 outbox row를 추가 생성하지 않는다.
- worker는 stable `eventId`로 retry한다.
- Gateway/consumer는 `eventId` 또는 `messageId`로 중복 delivery를 안전하게 처리한다.
- 성공한 outbox row의 보존·정리 정책과 poison event 처리 정책을 둔다.

Outbox를 도입해도 stream sync는 제거하지 않는다. broker publish 성공 이후의 Gateway/socket/client 실패를 복구하는 최종 안전망으로 남긴다.

## 17. 위험과 미결정

### 결정 필요

- WebSocket sync만 제공할지 HTTP history endpoint도 같은 use case adapter로 제공할지.
- 기본/최대 page 크기 `50/100`이 실제 payload와 지연 목표에 적절한지.
- 한 번의 sync에서 허용할 최대 page 수 또는 최대 message 수.
- `history_gap` 발생 시 전체 reload, 사용자 안내, 운영 경고 중 어떤 동작을 할지.
- cursor를 브라우저 memory, session storage, IndexedDB 중 어디까지 보존할지. 영구 보존은 Flow 9와 함께 결정한다.
- publisher 제한시간과 retry 횟수. message request 안에서 장시간 retry하지 않는 것을 기본으로 한다.
- publish observer를 package port로 둘지 publisher adapter가 직접 기록할지. 오류를 현재 package가 삼키는 구조라면 observer port가 필요하다.

### 주요 위험

- 권한 확인 뒤 query 사이에 membership이 철회되는 경쟁은 짧게 존재한다. 보안 요구 수준에 따라 transaction/권한 provider 일관성 모델을 정해야 한다.
- 고정 상한 없이 페이지를 읽으면 활발한 stream에서 sync가 끝나지 않거나 cursor 의미가 흔들릴 수 있다.
- client가 가장 큰 수신 sequence를 곧바로 `lastSeenSequence`로 저장하면 중간 gap을 영구 누락할 수 있다.
- publish 실패 로그만 있고 알림 기준이 없으면 운영에서 장기간 발견하지 못할 수 있다.
- message table의 hard delete/retention을 나중에 도입하면 “sequence는 연속” 전제를 다시 설계해야 한다.
- 거대한 content와 큰 page limit 조합은 API/Gateway payload 상한과 memory를 압박한다.

## 18. 문서 경계 반영

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 배경 계획이다.
- 소비자가 읽을 sync DTO와 의미는 `packages/realtime-chat-stream-sync-contracts/README.md`와 public contract에 둔다.
- sync provider의 query, snapshot, 권한 port, 테스트 전략은 provider `owner-docs`에 둔다.
- 앱의 endpoint/event/config 변화는 각 앱 `public-docs/runtime-contract.md`에 반영한다.
- 전역 `notes`와 provider `notes`는 consumer agent route에서 제외한다.
- parent deny 아래 public path를 다시 여는 권한 구조는 사용하지 않는다.
