# Flow 08 Read Cursor 전진 및 unread 제거 구현 계획

> **문서 상태: 이슈 작성용 구현 계획이며 현재 계약이 아니다.**
>
> 이 문서는 `flow-sequence-guide.md`의 Flow 8과 이벤트 스토밍 스케치를 현재 코드 구조에서 구현하기
> 위한 사람용 `notes`다. 에이전트 기본 문맥이나 소비자 계약 경로에 포함하지 않는다. 구현 과정에서
> 확정된 외부 계약은 각 provider의 `README.md`와 `public-docs/`에, 내부 불변조건과 테스트 전략은
> `owner-docs/`에 별도로 승격한다.

## 1. 목적과 범위

사용자 개인의 stream별 마지막 읽은 위치를 저장하고, 늦게 도착하거나 중복된 요청이 있어도 읽음 위치가
절대로 뒤로 가지 않게 한다. 읽음 위치를 기준으로 해당 사용자에게만 보이는 unread 상태를 제거하거나
줄인다.

핵심 불변조건은 다음과 같다.

- Read Cursor는 canonical `userId + streamId`마다 최대 한 행이다.
- `lastReadSequence`는 증가만 하고 감소하지 않는다.
- 요청 순번은 해당 stream의 현재 `last_sequence`를 넘을 수 없다.
- 사용자가 읽을 수 없는 stream에는 cursor를 만들거나 갱신할 수 없다.
- cursor가 전진하지 않은 no-op 요청은 성공으로 응답하되 저장 시각과 projection을 불필요하게 흔들지
  않는다.
- 읽음 처리는 다른 사용자에게 공개되는 읽음 receipt가 아니다.
- `ReadCursorAdvanced`가 필요하더라도 사용자 개인 projection용 내부 이벤트이며, 메시지 수신자나 채널
  구성원에게 공개 broadcast하지 않는다.
- unread는 cursor에서 파생되는 개인 상태다. 별도 projection을 두더라도 cursor가 원천 상태다.

이 이슈의 기본 범위는 채널 stream의 cursor 전진, 개인 unread 계산 또는 제거, API/Gateway relay,
backend 계약과 검증이다. DM과 thread 정책은 아래 MVP 선택에 따라 제한한다.

## 2. 현재 상태

### 현재 작업 트리

- `apps/realtime-chat-api`는 gateway ticket 발급·소비만 조립한다.
- `apps/realtime-chat-gateway`는 ticket 인증과 로컬 WebSocket session만 소유한다.
- Read Cursor, stream sync, unread query/projection package와 DB table은 없다.
- 현재 인증 경계가 확정하는 값은 `actorId`다. 지속성 기준의 canonical `userId`와 어떤 관계인지 아직
  확정되지 않았다.
- channel membership과 stream 읽기 권한의 기준 상태를 소유하는 package도 아직 없다.
- web 채팅 화면은 메시지 목록과 전송 상태만 다루며 channel 목록 unread badge나 mark-read transport는
  없다.

### 메시지 전송 PR에서 확인한 선행 stream 계약

브랜치 전환 없이 확인한 로컬 `feat/26-message-send` PR 스냅샷은 다음을 도입한다.

- `message_streams(stream_id, target_type, target_id, last_sequence, created_at)`
- `messages(stream_id, sequence, ...)`
- stream별 양의 정수 sequence와 `(stream_id, sequence)` uniqueness
- channel/DM/thread target을 `channel:<id>`, `dm:<id>`, `thread:<id>` 형태의 stream으로 해석하는 현재
  기본 resolver
- `last_sequence`와 message `sequence`의 PostgreSQL 타입은 현재 `integer`
- 메시지 전송 package의 명시적 비책임에 `read cursor`와 `stream sync`가 포함됨

따라서 Read Cursor는 메시지 전송 package에 추가하지 않고 독립 책임 package로 둔다. 다만 cursor의
상한과 unread 파생에는 `message_streams.last_sequence` 공개 table contract 또는 그 값을 제공하는
stream 조회 계약이 필요하다. PR 병합 뒤 실제 stream ID 규칙과 table contract를 다시 확인한다.

## 3. `userId`와 `actorId` 경계

문서 스케치는 `ReadCursor(userId, streamId, lastReadSequence)`를 사용하지만 현재 런타임 session과 인증
문맥은 `actorId`를 제공한다. 두 값을 암묵적으로 같은 값으로 취급하지 않는다.

### 권장 경계

```txt
actorId
  현재 인증된 요청 주체를 식별하는 런타임 principal ID
  Gateway ticket/session과 API 인증 문맥에서 확정

userId
  장기간 저장되는 사용자 개인 상태의 owner ID
  Read Cursor 기본 키에 사용
```

API adapter는 신뢰된 `actorId`를 identity provider를 통해 canonical `userId`로 해석한 뒤 Read Cursor
유스케이스를 호출한다. 클라이언트 request와 WebSocket event에는 `actorId`나 `userId`를 넣지 않는다.
Gateway relay를 사용할 때 Gateway는 ticket에서 확정한 session actor만 내부 API 인증 문맥에 전달한다.

MVP에서 `actorId`가 canonical user ID와 영구적으로 1:1이라는 인증 계약을 먼저 확정한다면 별도 조회를
생략할 수 있다. 이 경우에도 adapter에서 의미를 명시적으로 `userId`로 변환하고 계약 문서에 동일성
불변조건을 기록한다. “현재 값이 우연히 같다”는 이유로 DB의 `user_id`에 임의의 actor 값을 저장하지
않는다.

서비스 계정, 봇, 게스트 actor가 개인 cursor를 가질 수 있는지도 identity 계약에서 결정한다. 사용자로
해석할 수 없는 actor는 `read_cursor_forbidden` 같은 도메인 거절 또는 인증 오류로 처리하고 임시 user
행을 만들지 않는다.

## 4. stream 해석과 읽기 권한 경계

Gateway는 `streamId` 형식과 session 유무만 검증하며 해당 사용자가 stream을 읽을 수 있는지는 판단하지
않는다. API가 다음 순서로 처리한다.

1. 신뢰된 actor를 canonical user로 해석한다.
2. `streamId`를 기준 상태에서 조회해 stream 종류와 owner target을 확인한다.
3. Permission provider에 `canRead(userId, stream target)`를 요청한다.
4. 허용된 경우에만 stream 상한을 확인하고 cursor를 갱신한다.

클라이언트가 `channelId`와 `streamId`를 함께 보내 서로 다른 대상을 조합하게 하지 않는다. cursor command는
서버가 발급하거나 message/history 계약에서 받은 opaque `streamId` 하나만 받는 방식을 기본안으로 한다.
읽기 권한 adapter는 `message_streams.target_type/target_id`를 권한 provider의 공개 입력으로 번역한다.

private channel, DM, thread는 각각 다음 권한이 필요하다.

- channel: 사용자가 channel을 볼 수 있는지
- DM: 사용자가 해당 DM participant인지
- thread: root message와 그 상위 channel/DM을 읽을 수 있는지

권한 provider timeout, DB 오류, malformed 응답은 `denied`로 낮추지 않는다. 읽음 위치는 갱신하지 않되
재시도 가능한 인프라 실패로 처리한다. 읽기 권한을 판단하지 못했을 때 fail-open하지 않는다.

## 5. 단조 증가, 상한 검증, 동시성

### 단조 증가

초기 cursor 부재는 논리적으로 `lastReadSequence = 0`이다. message sequence는 1부터 시작한다. 요청
순번이 현재 cursor보다 작거나 같으면 no-op 성공이며, 응답에는 DB의 현재 유효 cursor를 반환한다.

```txt
requested > current  -> advanced
requested <= current -> unchanged
```

애플리케이션에서 `SELECT current -> 비교 -> UPDATE`만 수행하면 동시 요청 순서에 따라 cursor가 뒤로 갈 수
있다. DB write 자체가 다음 조건을 원자적으로 보장해야 한다.

```sql
ON CONFLICT (user_id, stream_id) DO UPDATE
SET last_read_sequence = EXCLUDED.last_read_sequence,
    updated_at = EXCLUDED.updated_at
WHERE read_cursors.last_read_sequence < EXCLUDED.last_read_sequence
```

또는 `GREATEST(read_cursors.last_read_sequence, EXCLUDED.last_read_sequence)`를 사용할 수 있지만, no-op에도
`updated_at`이 바뀌지 않도록 조건부 update를 함께 사용한다. 서로 다른 연결에서 100과 120을 동시에
요청해도 최종 값은 120이어야 한다.

### stream 상한

클라이언트가 실제로 존재하지 않는 미래 순번을 cursor로 저장하면 이후 메시지가 unread로 보이지 않을 수
있다. 따라서 다음을 검증한다.

```txt
0 <= requestedSequence <= message_streams.last_sequence
```

- 음수, 소수, `NaN`, 무한대, 안전 정수 범위 밖 값은 transport/contracts validation에서 거절한다.
- 현재 message PR의 DB 타입이 `integer`이므로 병합 시점에는 PostgreSQL integer 범위와도 일치시킨다.
- `requestedSequence > last_sequence`는 조용히 clamp하지 않고 `sequence_out_of_range`로 거절한다. 잘못된
  클라이언트 상태를 숨기지 않기 위함이다.
- `requestedSequence = 0`은 cursor가 없거나 0일 때 no-op으로 취급할 수 있다. 실제 행을 만들지 않는 것을
  기본안으로 한다.

현재 sequence가 연속이라는 메시지 계약에서는 `requested <= last_sequence`면 읽음 위치로 유효하다.
향후 hard delete로 sequence gap이 생기더라도 cursor는 “특정 메시지”가 아니라 위치 경계이므로 gap 위에
놓일 수 있다. 따라서 `last_read_message_id`는 MVP 원천 상태에 넣지 않는다.

### permission과 상한의 일관성

읽기 권한을 먼저 확인해 권한 없는 사용자가 stream 상한을 관찰하지 못하게 한다. 권한과 stream이 같은
DB에 있고 강한 일관성이 필요하면 한 transaction에서 검증한다. 외부 Permission provider라면 권한 철회와
cursor update 사이의 짧은 TOCTOU를 허용할지, provider version 검사를 도입할지 별도로 결정한다.

`message_streams.last_sequence`는 증가만 하므로 상한 조회 직후 새 메시지가 추가되는 경쟁은 안전하다.
조회한 상한 이하를 읽음 처리한 뒤 상한이 커지면 새 메시지는 정상적으로 unread가 된다.

## 6. DB table과 쿼리 계획

### table

메시지 PR의 `integer` sequence와 맞춘 MVP 예시는 다음과 같다.

```sql
CREATE TABLE IF NOT EXISTS read_cursors (
  user_id text NOT NULL,
  stream_id text NOT NULL REFERENCES message_streams(stream_id),
  last_read_sequence integer NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, stream_id),
  CHECK (last_read_sequence >= 0)
);

CREATE INDEX IF NOT EXISTS read_cursors_stream_id_idx
  ON read_cursors (stream_id);
```

`last_read_message_id`는 cursor 기준을 sequence 하나로 유지하기 위해 MVP에서 제외한다. message 삭제와 FK
정책도 불필요하게 결합하지 않는다. stream 삭제 시 cursor를 `CASCADE`할지, stream tombstone을 유지할지는
stream 생명주기 결정 전까지 명시하지 않는다.

### 상한 조회

권한이 확인된 stream에 대해 `message_streams.last_sequence`를 읽는다. stream 부재와 권한 거절의 외부
노출 정책을 적용한 뒤 요청 상한을 검증한다. 권한 없는 사용자에게 `last_sequence`를 응답하지 않는다.

### 원자적 upsert

구현 helper는 최소한 다음 결과를 구분한다.

```ts
type AdvanceReadCursorResult =
  | {
      status: "advanced";
      userId: string;
      streamId: string;
      lastReadSequence: number;
      updatedAt: string;
    }
  | {
      status: "unchanged";
      userId: string;
      streamId: string;
      lastReadSequence: number;
      updatedAt?: string;
    };
```

조건부 upsert가 `RETURNING` 행을 주지 않은 no-op 경우에는 현재 cursor를 다시 읽는다. 동시 요청 때문에
요청 값보다 큰 cursor가 보이면 그 값을 그대로 effective cursor로 반환한다. `requested = 0`이고 행이
없으면 `{ status: "unchanged", lastReadSequence: 0 }`을 반환한다.

상한 조회와 upsert를 한 SQL/transaction으로 묶을 수도 있다. 어떤 형태든 다음 조건은 DB 수준에서
검증돼야 한다.

- cursor 단조 증가
- 존재하는 stream FK
- 요청이 검증된 현재 stream 상한 이하임
- no-op에서 `updated_at` 불변

### migration 조립 순서

`packages/realtime-chat-database`는 message stream table 생성 뒤 read cursor table을 생성한다. read cursor
package가 message-send package 내부 구현을 deep import하지 않도록 공개 `table-contract` 또는 database
composition 경계를 사용한다.

## 7. unread projection 정책

### MVP 권고: cursor를 원천으로 조회 시 파생

별도 mutable unread count table을 먼저 만들지 않는다. 기본 계산은 사용자 개인 cursor와 stream
상한에서 파생한다.

```txt
effectiveCursor = COALESCE(read_cursor.last_read_sequence, 0)
hasUnread       = message_streams.last_sequence > effectiveCursor
```

단순 unread count를 제공한다면 현재처럼 sequence가 연속이고 모든 stream 메시지가 사용자에게 동일하게
보인다는 전제에서 다음을 사용할 수 있다.

```txt
unreadCount = MAX(0, last_sequence - effectiveCursor)
```

하지만 메시지 hard delete, 사용자별 필터, 숨김 메시지, 자신의 메시지 제외 정책이 생기면 이 차이는 실제
개수와 달라진다. 그때는 `messages WHERE sequence > cursor`를 세거나 별도 projection을 도입한다.

`markRead(50)`을 처리할 때 최신 순번이 100이면 unread를 전부 제거하지 않는다. cursor가 최신 상한에
도달했을 때만 `hasUnread=false` 또는 badge clear가 된다. 초기 흐름 스케치의 “cursor 전진 = badge
cleared”를 그대로 구현하지 않는다.

### projection이 필요해질 때

채널 목록 성능 때문에 materialized projection을 두면 다음 규칙을 지킨다.

- key는 `userId + streamId`이며 다른 사용자의 상태와 공유하지 않는다.
- `ReadCursorAdvanced(userId, streamId, effectiveSequence)`는 내부 사용자 projection 이벤트다.
- projection handler는 sequence 기준으로 멱등하고 이전 이벤트가 늦게 와도 뒤로 가지 않는다.
- cursor commit이 원천 상태이며 projection 지연은 허용한다.
- projection 실패가 cursor 전진을 rollback할 필요는 없다. 재처리 또는 조회 시 재계산으로 복구한다.
- 공개 outbound message delivery topic이나 channel recipient 목록으로 이벤트를 발행하지 않는다.

### 자신의 메시지와 unread

사용자가 보낸 자신의 메시지를 unread에 포함할지 아직 정해지지 않았다. 단순 sequence 차이는 자신의
메시지도 센다. 다음 중 하나를 별도 정책으로 확정해야 한다.

- 메시지 전송 성공 시 해당 사용자가 실제로 stream을 보고 있었다면 cursor도 전진
- unread query에서 자신의 메시지를 제외
- 클라이언트가 화면에 표시된 최신 sequence로 곧바로 markRead를 전송

Flow 8에서는 메시지 전송 transaction에 cursor update를 암묵적으로 끼워 넣지 않는다.

## 8. socket/API 계약 후보

최종 계약은 별도 contracts package가 소유한다. 아래는 이슈 작성용 후보이며 현재 계약이 아니다.

### Client -> Gateway

```json
{
  "type": "chat.stream.markRead",
  "commandId": "cmd-read-001",
  "streamId": "channel:channel-1",
  "lastReadSequence": 184
}
```

클라이언트가 `userId`, `actorId`, `lastReadMessageId`를 보내지 않는다.

### API command

```ts
type MarkStreamReadCommand = {
  commandId: string;
  streamId: string;
  requestedSequence: number;
};

type MarkStreamReadContext = {
  actorId: string; // adapter에서 인증 문맥으로 제공
};
```

유스케이스 내부에는 identity 해석이 끝난 canonical `userId`를 전달하거나, identity resolver 포트를
명시적으로 주입한다.

### accepted

```json
{
  "type": "chat.stream.markRead.accepted",
  "commandId": "cmd-read-001",
  "streamId": "channel:channel-1",
  "lastReadSequence": 184,
  "advanced": true
}
```

no-op 요청은 `advanced: false`와 현재 effective cursor를 반환한다. 응답은 요청한 socket에만 보낸다.
같은 사용자의 다른 tab 동기화가 필요하면 향후 user-scoped private event를 별도 설계할 수 있지만, 채널
구성원이나 메시지 recipient에게 공개 broadcast하지 않는다.

### rejected

```json
{
  "type": "chat.stream.markRead.rejected",
  "commandId": "cmd-read-001",
  "streamId": "channel:channel-1",
  "reason": "sequence_out_of_range"
}
```

거절 사유 후보는 다음과 같다.

- `stream_not_found`
- `read_forbidden`
- `sequence_out_of_range`
- `invalid_request`는 가능하면 Gateway/contracts validation에서 처리

private stream 존재 노출을 막기 위해 `stream_not_found`와 `read_forbidden`을 외부에서 하나로 축약할 수
있다. API timeout, Permission provider 장애, DB 오류, malformed 내부 응답은 도메인 거절로 위장하지 않고
재시도 가능한 `gateway.error` 또는 5xx 경로로 처리한다.

### HTTP 경계

Flow 8 기본안은 WebSocket command를 Gateway가 내부 API HTTP로 relay하는 것이다. 내부 endpoint 예시는
다음과 같다.

```txt
POST /internal/realtime-chat/read-cursors/mark
```

Gateway 인증과 신뢰된 actor 문맥을 body 밖에서 전달하고 body에는 command만 둔다. 직접 public HTTP를
제공할지는 message-send와 전체 client transport 결정을 맞춰 별도로 정한다. 도메인 accepted/rejected는
판별 합집합으로 보존하고, 통신 오류와 섞지 않는다.

## 9. 예상 패키지와 파일

실제 이름은 병합 후 repository 규칙에 맞춘다. 기존 동일 책임 package가 생기면 중복 생성하지 않는다.

### contracts

```txt
packages/realtime-chat-read-cursor-contracts/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  src/index.ts
  test/mark-read-request.test.ts
```

작은 package라면 README가 충분한지 판단하고 불필요한 빈 문서를 만들지 않는다. 공개 계약에는 event/HTTP
DTO, validation schema, reason 코드, 단조 증가와 비공개 읽음 불변조건을 둔다.

### Read Cursor provider

```txt
packages/realtime-chat-read-cursor/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  owner-docs/architecture.md
  owner-docs/testing.md
  src/index.ts
  src/read-cursor-module.ts
  src/read-cursor-table.ts
  src/table-contract.ts
  src/usecases/mark-stream-read/mark-stream-read.usecase.ts
  src/usecases/mark-stream-read/mark-stream-read.kysely.ts
  test/mark-stream-read-usecase.test.ts
  test/mark-stream-read-postgres.integration.test.ts
```

이 package는 identity, stream resolver, read authorizer를 포트로 받고 cursor 정책과 DB 원자성을 소유한다.
channel/DM/thread membership 자체를 소유하지 않는다.

### database composition

```txt
packages/realtime-chat-database/
  package.json
  README.md
  src/realtime-chat-database.ts
```

`RealtimeChatDatabase`에 read cursor table contract를 합성하고 message stream 다음 migration 순서를
보장한다.

### API/Gateway adapter

```txt
packages/realtime-chat-api/                           # 통합 package가 존재할 때
  src/read-cursor/identity-resolver.ts
  src/read-cursor/stream-read-authorizer.ts
  src/read-cursor/mark-read-handler.ts
  test/read-cursor/*.test.ts

packages/realtime-chat-gateway/                       # Gateway 책임 package가 도입될 때
  src/read-cursor/mark-read-relay.ts
  test/mark-read-relay.test.ts

apps/realtime-chat-api/
  src/app.ts
  src/runtime/create-runtime-deps.ts
  test/app-smoke.test.ts
  public-docs/runtime-contract.md

apps/realtime-chat-gateway/
  src/app.ts
  src/runtime/create-runtime-deps.ts
  src/runtime/realtime-chat-api-client.ts              # package 이전 전의 임시 위치일 때
  test/app-smoke.test.ts
  test/realtime-chat-api-client.test.ts
  public-docs/runtime-contract.md
```

도메인 규칙, SQL, event parsing을 앱에 쌓지 않는다. 앱은 HTTP/WebSocket 서버 실행과 package 조립만
소유한다.

### web과 unread consumer

```txt
apps/web/src/features/chat/transport/chatTransport.ts
apps/web/src/features/chat/transport/<실제-transport>.ts
apps/web/src/features/chat/useChatRoom.ts
apps/web/src/features/<channel-list-or-unread>/...
```

web은 backend contracts package를 소비하고 화면에 실제로 표시된 최대 sequence만 markRead로 보낸다.
viewport 기반 부분 읽음을 할지 “채널 열기 시 최신까지 읽음”으로 볼지는 UX 정책으로 별도 확정한다.

## 10. 단계별 구현

1. **선행 PR과 stream 계약 재확인**
   - message-send PR 병합 후 `message_streams`, sequence 타입, stream ID 생성 규칙을 확인한다.
   - read cursor가 message-send 내부 package를 deep import하지 않을 공개 table/stream 계약을 정한다.
2. **identity 계약 확정**
   - `actorId == userId`인지 identity mapping이 필요한지 결정한다.
   - cursor를 가질 수 있는 principal 종류를 정한다.
3. **MVP 대상과 thread 정책 확정**
   - 우선 channel cursor만 구현할지 DM도 함께 포함할지 정한다.
   - thread 정책은 아래 11절의 선택을 이슈 acceptance criteria에 명시한다.
4. **contracts package 구현**
   - strict schema와 정수/범위 검증을 추가한다.
   - accepted/rejected 판별 합집합과 correlation 필드를 정의한다.
   - 공개 읽음 broadcast 금지를 public invariant로 문서화한다.
5. **read cursor table과 query 구현**
   - 복합 PK, FK, check, timestamptz를 만든다.
   - 상한 검증과 조건부 upsert를 구현한다.
   - no-op에는 `updated_at`을 바꾸지 않는다.
6. **MarkStreamRead 유스케이스 구현**
   - identity 해석, stream resolve, canRead, 상한 검증, atomic advance 순서를 고정한다.
   - 실제 전진 때만 개인 projection event를 생성한다.
7. **unread 조회 또는 projection 구현**
   - MVP는 cursor와 stream 상한에서 `hasUnread`를 파생한다.
   - count가 필요하면 현재 가정을 문서화하고 자신의 메시지 정책을 정한다.
8. **database runtime에 조립**
   - message stream migration 뒤 cursor migration을 실행한다.
   - readiness와 close 의미는 바꾸지 않는다.
9. **API endpoint와 adapter 구현**
   - body의 user/actor 값을 거절하고 인증 문맥만 사용한다.
   - domain rejected와 infrastructure error를 구분한다.
10. **Gateway relay 구현**
    - session actor로 API를 호출하고 requester socket에만 결과를 보낸다.
    - 공개 channel fan-out/outbound delivery bus에는 읽음 event를 싣지 않는다.
11. **web 연결**
    - 화면에 실제로 반영된 최대 sequence를 전송한다.
    - accepted의 effective cursor로 로컬 unread를 보정한다.
12. **문서 승격과 종단 검증**
    - 확정된 계약만 각 provider README/public docs와 owner docs에 반영한다.
    - 이 notes 문서를 AGENTS route에 추가하지 않는다.

## 11. thread cursor MVP 선택

Flow 문서는 “MVP에서는 channel read cursor와 thread read cursor를 분리하지 않을 수 있다”고 제안한다.
그러나 메시지 전송 PR은 thread reply를 별도 stream과 별도 sequence로 모델링한다. 서로 다른 sequence를
같은 cursor 값으로 비교하면 의미가 깨진다.

따라서 Flow 8의 권고 MVP는 다음이다.

- channel cursor만 먼저 구현한다.
- thread stream에 channel cursor 값을 쓰지 않는다.
- thread reply를 channel unread count에 임의로 합산하지 않는다.
- MVP에서 thread unread 표시가 필요 없다면 `chat.stream.markRead`의 thread target을
  `unsupported_stream_type`으로 거절하거나 계약상 아직 노출하지 않는다.
- thread unread가 제품 요구사항에 들어오면 `userId + threadStreamId`의 별도 cursor를 추가한다.
- channel 목록에서 thread activity를 unread로 보일 필요가 있다면 thread sequence를 channel activity
  projection으로 변환하는 별도 정책을 설계한다.

즉 “분리하지 않는다”는 동일 cursor에 서로 다른 stream sequence를 섞는다는 뜻이 아니라, MVP에서 thread
cursor/unread 기능 자체를 미지원한다는 뜻으로 제한한다. DM은 DM 기능이 도입될 때 같은 cursor 모델을
재사용하되 participant 권한 테스트를 추가한다.

## 12. 테스트 계획

### 단위 테스트

- cursor 부재 상태에서 sequence 10 요청은 10으로 전진한다.
- 현재 10에서 20 요청은 20으로 전진한다.
- 현재 20에서 20 또는 10 요청은 `unchanged`, effective 20이다.
- 실제 전진 때만 `ReadCursorAdvanced` 개인 projection 이벤트가 생성된다.
- no-op에는 projection event가 생성되지 않는다.
- requested가 음수, 소수, 비정상 숫자면 contracts validation에서 거절된다.
- requested가 stream 상한보다 크면 `sequence_out_of_range`이고 upsert를 호출하지 않는다.
- canRead 거절이면 stream 상한이나 cursor를 외부에 노출하지 않고 write하지 않는다.
- Permission provider 예외는 `read_forbidden`으로 변환되지 않는다.
- identity로 user를 해석할 수 없으면 cursor 행을 만들지 않는다.
- thread 미지원 MVP에서는 thread stream 요청을 명시적 거절한다.

### PostgreSQL 통합 테스트

- 첫 요청이 `(user_id, stream_id)` 행을 정확히 하나 만든다.
- 100과 120의 동시 upsert가 어떤 완료 순서에서도 최종 120이다.
- 더 낮은 요청이 늦게 commit돼도 cursor가 감소하지 않는다.
- 같은 sequence 동시 요청은 한 행만 유지하고 no-op 쪽에서 `updated_at`을 불필요하게 변경하지 않는다.
- 존재하지 않는 stream에는 FK 또는 유스케이스 검증으로 cursor를 만들 수 없다.
- `requested > message_streams.last_sequence`는 행을 만들거나 갱신하지 않는다.
- cursor 전진 뒤 새 메시지가 추가되면 stream 상한만 증가하고 `hasUnread=true`로 파생된다.
- cursor가 최신 상한까지 전진하면 `hasUnread=false`다.
- 사용자 A의 cursor update가 사용자 B의 cursor에 영향을 주지 않는다.
- transaction rollback 시 cursor와 projection/outbox 상태가 부분 저장되지 않는다.

실제 PostgreSQL에서 검증한다. 빈 객체를 Kysely로 type assertion한 테스트만으로 원자성과 제약조건을 완료
판정하지 않는다.

### API 통합 테스트

- 인증 문맥의 actor만 사용하고 body의 `actorId`/`userId`를 허용하지 않는다.
- identity mapping 뒤 canonical user로 유스케이스를 호출한다.
- read permission이 없으면 안정적인 rejected 계약을 반환한다.
- accepted/no-op 모두 effective cursor와 correlation을 보존한다.
- provider/DB 오류는 5xx 또는 재시도 가능 내부 오류이며 domain rejected와 다르다.
- private stream의 존재 노출 정책이 status와 reason에서 일관된다.

### Gateway 통합 테스트

- 인증된 session이 없으면 API를 호출하지 않는다.
- malformed payload와 frame 상한 초과는 transport 경계에서 거절한다.
- API accepted/rejected를 요청한 socket에만 한 번 보낸다.
- 다른 사용자의 local session에는 어떤 읽음 event도 보내지 않는다.
- 동일 사용자의 다른 session에도 기본 Flow 8에서는 자동 broadcast하지 않는다.
- API timeout, 5xx, malformed response는 retryable Gateway 오류다.

### E2E 테스트

```txt
Given user A의 channel stream cursor가 100이고 최신 sequence가 150이며
When user A가 lastReadSequence 150으로 markRead를 보내면
Then 응답의 effective cursor는 150이고 advanced는 true이며
And user A의 channel hasUnread는 false이고
And user B의 cursor와 unread는 변하지 않으며
And user B를 포함한 channel 구성원에게 읽음 event가 broadcast되지 않는다.
```

```txt
Given user A의 cursor가 150이고
When 서로 다른 연결에서 120과 180 요청이 경쟁하며 stream 상한은 200이면
Then 최종 cursor는 180이고
And 늦게 끝난 120 요청 때문에 cursor가 감소하지 않는다.
```

```txt
Given stream 최신 sequence가 200이고
When user A가 999를 markRead로 보내면
Then sequence_out_of_range로 거절되고
And cursor와 unread projection은 변하지 않는다.
```

브라우저 E2E를 포함한다면 채널 화면이 렌더링한 최신 sequence까지만 markRead하고, accepted 결과 뒤 해당
사용자의 badge만 사라지는지 확인한다.

## 13. 완료 조건

- canonical `userId`와 runtime `actorId`의 관계가 공개 identity 계약으로 확정돼 있다.
- 읽기 권한이 API/provider 경계에서 확인되고 Gateway나 client가 판단하지 않는다.
- `read_cursors` 복합 키와 조건부 upsert가 DB 수준에서 단조 증가를 보장한다.
- 요청 순번이 stream의 현재 상한을 넘으면 저장되지 않는다.
- 동시 순서 역전 테스트가 실제 PostgreSQL에서 통과한다.
- no-op 요청은 현재 effective cursor를 반환하고 `updated_at`과 projection을 흔들지 않는다.
- unread의 source of truth는 cursor이며 최신 상한 도달 여부에 따라 해당 사용자 상태만 제거된다.
- 읽음 event가 channel 구성원, message recipient, outbound delivery bus로 공개 broadcast되지 않는다.
- thread cursor 미지원 또는 별도 cursor 정책이 계약과 테스트에 명시돼 있다.
- API/Gateway 계약이 accepted, domain rejected, infrastructure error를 구분한다.
- 확정된 consumer 계약과 owner 규칙이 각 package의 README/public docs/owner docs에 반영돼 있다.
- 이 notes 문서는 agent route에 포함되지 않는다.

## 14. 비범위

- 공개 읽음 receipt, “누가 읽었는지”, 카카오톡식 안 읽은 인원 수
- 메시지별 read receipt table
- Presence나 typing indicator
- 메시지 delivery 성공 추적
- stream sync/afterSequence 누락 복구 본체
- 메시지 전송, sequence 발급, fan-out 본체 재구현
- 채널/DM/thread membership 관리 기능 자체
- push notification read state
- thread unread가 필요할 때의 channel activity projection
- unread projection 캐시의 대규모 성능 최적화

## 15. 위험과 미결정

1. **identity 미확정**: 현재 `actorId`가 persistent `userId`인지 보장되지 않는다. 확정 없이 cursor key를
   만들면 계정 연결이나 principal 모델 변경 때 데이터가 고립될 수 있다.
2. **read permission 원천 부재**: 현재 저장소에는 channel membership/DM participant의 기준 상태가 없다.
3. **stream 계약 병합 전 상태**: message PR의 table과 stream ID 규칙이 최신 runtime 브랜치와 합쳐진 뒤
   달라질 수 있다.
4. **transport 미확정**: WebSocket relay와 직접 HTTP 중 primary mark-read 경로를 전체 채팅 transport
   결정과 맞춰야 한다.
5. **자신의 메시지 unread 정책**: 단순 sequence 차이는 자신의 메시지도 unread로 계산한다.
6. **부분 읽음 UX**: 채널을 열기만 하면 최신까지 읽음인지, viewport에 실제 노출된 sequence까지만
   읽음인지 결정되지 않았다.
7. **private stream 존재 노출**: `stream_not_found`와 `read_forbidden`을 구분할지 보안 정책이 필요하다.
8. **thread MVP 의미**: 별도 sequence를 가진 thread를 channel cursor에 섞으면 안 된다. thread unread를
   미지원할지 별도 cursor를 바로 만들지 선택해야 한다.
9. **sequence 타입**: message PR은 PostgreSQL `integer`를 사용한다. 장기적으로 `bigint`가 필요하면 JS
   number 직렬화와 함께 migration 전략을 정해야 한다.
10. **stream 삭제 정책**: cursor FK를 cascade할지 tombstone과 함께 유지할지 미정이다.
11. **projection 복구**: materialized unread projection을 도입할 경우 재처리, 순서 역전, rebuild 방식을
    정해야 한다.
12. **권한 TOCTOU**: 외부 Permission provider 확인 직후 권한이 철회될 수 있다. MVP 허용 범위 또는 version
    검사가 필요하다.
13. **같은 사용자의 여러 tab**: requester에만 ack할지 user-scoped private sync event를 추가할지 미정이다.

## 16. 문서 경계 메모

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 배경 자료다.
- 소비자가 읽을 공개 계약 후보는 다음 위치다.
  - `packages/realtime-chat-read-cursor-contracts/README.md`
  - `packages/realtime-chat-read-cursor-contracts/public-docs/api.md`
  - `packages/realtime-chat-read-cursor-contracts/public-docs/invariants.md`
  - `packages/realtime-chat-read-cursor/README.md`
  - `packages/realtime-chat-read-cursor/public-docs/api.md`
  - `packages/realtime-chat-read-cursor/public-docs/invariants.md`
  - `apps/realtime-chat-api/public-docs/runtime-contract.md`
  - `apps/realtime-chat-gateway/public-docs/runtime-contract.md`
- consumer에서는 각 provider의 `AGENTS.md`, `owner-docs/`, `notes/`를 기본 문맥으로 읽지 않는다.
- owner는 provider `AGENTS.md`가 가리키는 `owner-docs/*`를 읽는다.
- 이 notes 파일을 owner 또는 consumer AGENTS route에 포함하지 않는다.
- parent directory deny 뒤 child public docs를 재개방하는 permission 구조는 사용하지 않는다.
