# Flow 10 — Collaboration Session 시작 시스템 메시지 구현 계획

> **주의:** 이 문서는 현재 구현 계약이 아니라 GitHub 이슈 작성과 작업 브랜치 분리를 위한 사람용 구현 계획이다. 확정된 외부 계약은 각 provider의 `README.md`와 `public-docs/`에 별도로 반영해야 하며, 이 문서를 에이전트 기본 문맥이나 소비자 계약으로 사용하지 않는다.

## 1. 목적과 범위

Collaboration Session Context가 채널에 연결된 세션 시작을 알리면 Chat Context가 이를 시스템 메시지 한 건으로 기록하고 일반 메시지와 동일한 stream sequence와 delivery 경로에 태운다.

이 Flow의 목표는 다음과 같다.

- 외부 `SessionStarted` 계약을 검증하고 채팅 내부 command로 번역한다.
- 동일 세션 시작 이벤트가 재전달되거나 동시에 처리돼도 시스템 메시지를 한 번만 만든다.
- 시스템 메시지는 해당 channel stream 안에서 사용자 메시지와 동일한 sequence 불변조건을 지킨다.
- 시스템 메시지는 구조화된 content로 저장하고 공개 message DTO로 전달한다.
- 최초 생성된 시스템 메시지만 수신자에게 delivery를 요청한다.
- publish 실패가 시스템 메시지 저장을 롤백하지 않으며 Flow 7 sync로 복구된다.

이 이슈는 Collaboration Session 자체의 생성·상태 관리, 채널 멤버십 관리, Gateway fan-out 구현을 소유하지 않는다.

## 2. 현재 상태

현재 작업트리에는 Collaboration Session provider나 `SessionStarted` 계약 패키지가 없다. 저장소 전체에서 해당 이벤트는 이벤트 스토밍·흐름 스케치에만 존재한다.

현재 웹의 임시 메시지 타입에는 `MessageType = "USER" | "SYSTEM"`이 있지만, 백엔드와 연결된 계약이 아니며 system content를 표현하는 실제 transport 구현도 없다.

브랜치 전환 없이 확인한 로컬 `feat/26-message-send`는 다음 기반을 제공한다.

- channel/DM/thread target을 `message_streams`로 해석하는 경계
- stream row lock과 `last_sequence` 증가
- `messages` insert와 `(stream_id, sequence)` 유일성
- `PublicMessage`와 `OutboundMessageDeliveryRequested`
- 최초 생성에만 delivery를 요청하는 흐름

그러나 현재 메시지 PR의 모델은 사용자 text 메시지 전용이다.

- `sender_actor_id`가 `NOT NULL`이다.
- `client_message_id`가 `NOT NULL`이다.
- `message_type` 컬럼이 없다.
- content는 `content_type = text`, `content_text`만 지원한다.
- `PublicMessage`는 항상 `senderActorId`와 text content를 요구한다.
- 메시지 전송 README는 system message를 명시적으로 비책임으로 둔다.

따라서 `SessionStarted`를 가짜 sender나 가짜 `clientMessageId`를 넣어 사용자 메시지 API로 우회하면 안 된다. 시스템 메시지 전용 정책과 외부 이벤트 멱등성은 별도 slice가 소유하되, stream append transaction 불변조건은 사용자 메시지와 공유해야 한다.

## 3. 외부 SessionStarted 계약

Collaboration Session provider가 소유해야 할 최소 공개 계약의 권장 형태는 다음과 같다. 실제 필드명과 버전은 해당 provider의 public contract를 우선한다.

```ts
type CollaborationSessionStartedV1 = {
  eventId: string;
  eventType: "SessionStarted";
  eventVersion: 1;
  occurredAt: string;
  session: {
    sessionId: string;
    sessionType: "VIDEO_MEETING" | "PAIR_PROGRAMMING";
    workspaceId: string;
    channelId?: string;
    startedByActorId?: string;
  };
};
```

계약 원칙:

- `eventId`는 전달 시도 ID가 아니라 원본 도메인 이벤트 ID여야 한다.
- `sessionId`는 세션 생명주기 동안 안정적이어야 한다.
- `channelId`가 없는 세션 시작은 유효할 수 있지만 채팅 메시지 생성 대상은 아니다.
- `occurredAt`은 외부 도메인 발생 시각이고, 채팅 sequence는 채팅 DB commit 순서다.
- 사용자 표시명처럼 변경 가능하고 지역화가 필요한 문자열을 신뢰 경계의 필수 값으로 삼지 않는다.
- transport envelope의 broker offset, delivery attempt 같은 기술 필드는 도메인 payload와 분리한다.

외부 provider 계약이 아직 없으면 이 Flow 구현 전에 별도 이슈로 계약 패키지를 만든다. Chat Context가 이벤트 스토밍 문서의 JSON 예시를 사실상의 계약으로 복사하지 않는다.

## 4. Anti-corruption 경계

외부 event DTO는 API runtime의 subscriber adapter에서 strict schema로 검증한 뒤 내부 command로 변환한다.

```ts
type PostCollaborationSessionStartedMessage = {
  source: {
    context: "collaboration-session";
    eventType: "SessionStarted";
    eventId: string;
    entityId: string; // sessionId
    occurredAt: string;
  };
  target: {
    workspaceId: string;
    channelId: string;
  };
  session: {
    sessionId: string;
    sessionType: "video_meeting" | "pair_programming";
    startedByActorId?: string;
  };
};
```

adapter의 책임:

- event version과 strict shape 검증
- 외부 enum을 채팅 내부 enum으로 명시적으로 매핑
- `channelId`가 없으면 `ignored(not_channel_scoped)`로 종료
- 식별자·시각 길이와 형식 검증
- 내부 command 호출 결과에 따라 broker ack/retry/dead-letter 결정

adapter가 하지 않을 일:

- 외부 DTO를 시스템 메시지 패키지의 public API로 그대로 노출
- 외부 `startedBy`를 사용자 메시지 sender로 위장
- 채널 멤버십이나 stream sequence를 직접 조회·변경
- 사람이 읽는 message text를 외부 이벤트 문자열 그대로 저장

잘못된 schema/지원하지 않는 version은 재시도로 해결되지 않으므로 격리 또는 dead-letter 후 관측한다. DB 일시 장애와 publisher 일시 장애는 별도 분류한다. message commit 전 DB 장애는 retry하고, commit 후 publish 장애는 event를 다시 처리해 delivery를 복구하려 하지 않고 Flow 7/Outbox 정책을 따른다.

## 5. 내부 시스템 메시지 모델

공개 message DTO는 사용자 메시지와 시스템 메시지를 판별 가능한 union으로 확장한다.

```ts
type PublicMessage = UserMessage | CollaborationSessionStartedMessage;

type UserMessage = {
  messageType: "user";
  messageId: string;
  streamId: string;
  sequence: number;
  senderActorId: string;
  content: { type: "text"; text: string };
  createdAt: string;
};

type CollaborationSessionStartedMessage = {
  messageType: "system";
  messageId: string;
  streamId: string;
  sequence: number;
  content: {
    type: "collaboration_session_started";
    sessionId: string;
    sessionType: "video_meeting" | "pair_programming";
    startedByActorId?: string;
  };
  createdAt: string;
};
```

구조화 content를 기준 데이터로 저장한다. 화면 문구는 클라이언트 또는 presentation mapper가 지역화한다. 서버 렌더링 문구가 당장 필요하면 `fallbackText`를 선택 필드로 둘 수 있지만, 이벤트 provider가 보낸 표시명을 신뢰해 핵심 content로 저장하지 않는다.

`sourceEventId`와 내부 멱등성 키는 운영·추적용 내부 메타데이터다. 클라이언트가 필요하지 않다면 공개 DTO에 노출하지 않는다.

## 6. 시스템 메시지 멱등성 키

개념 키는 다음과 같다.

```text
SYSTEM_MESSAGE:collaboration-session:SessionStarted:<sessionId>
```

DB에서는 문자열 조합 하나보다 구조화된 열을 권장한다.

```text
message_source_keys
- source_context
- source_event_type
- source_entity_id
- source_event_id
- message_id
- created_at

PRIMARY KEY (source_context, source_event_type, source_entity_id)
UNIQUE (message_id)
```

`eventId`만 멱등성 기준으로 쓰지 않는다. 같은 `SessionStarted` 의미가 재발행되며 event ID가 바뀌어도 session당 시작 메시지는 한 건이어야 하기 때문이다. 반대로 `eventType`을 키에 포함해 향후 `SessionEnded`가 같은 session ID로 별도 메시지를 만들 수 있게 한다.

동일 semantic key에 다른 `channelId`, `workspaceId`, `sessionType`이 오면 최초 저장 결과를 유지하고 `source_payload_conflict`를 기록한다. 기존 메시지를 다른 stream으로 이동하거나 내용을 수정하지 않는다.

### 동시 중복 처리

같은 channel의 중복 이벤트는 stream row lock 뒤 source key를 재조회해 직렬화할 수 있다. 그러나 잘못된 중복 이벤트가 서로 다른 channel을 가리키면 서로 다른 stream lock을 잡으므로 source key DB 유일 제약이 최종 안전망이어야 한다.

권장 transaction 처리:

1. source key fast lookup. 존재하면 기존 결과 반환.
2. channel target을 안정적인 stream ID로 해석하고 연동 유효성 검증.
3. transaction 시작, stream row 생성/조회 및 `FOR UPDATE`.
4. source key 재조회. 존재하면 기존 결과 반환.
5. stream sequence 증가와 system message insert.
6. source key를 `ON CONFLICT DO NOTHING ... RETURNING`으로 insert.
7. source key insert가 0건이면 현재 transaction을 rollback하고 기존 message를 다시 읽어 `existing`으로 반환.
8. commit된 `created` 결과에만 delivery 요청.

sequence 증가와 message insert가 source key 경쟁에서 패했으면 반드시 함께 rollback돼야 한다. 실패한 시도가 sequence 빈칸이나 고아 message를 남기면 안 된다.

## 7. channel stream sequence와 메시지 PR 재사용

시스템 메시지는 사용자 메시지와 같은 `message_streams.last_sequence`를 사용한다.

```text
sequence 41: user message
sequence 42: SessionStarted system message
sequence 43: user message
```

메시지 PR에서 재사용할 항목:

- target → stream 해석 규칙
- stream row 생성과 lock
- `last_sequence + 1`
- `(stream_id, sequence)` 유일 제약
- message ID와 createdAt 생성 경계
- DB row의 엄격한 parsing
- `OutboundMessageDeliveryRequested` 경로
- publish 실패 시 저장 유지 정책

재사용하지 않을 항목:

- 사용자 `clientMessageId` 멱등성
- 사용자 write authorization
- sender accepted/rejected 계약
- text content 전용 validation

두 번째 append 소비자가 생기는 시점이므로 공통 stream append transaction을 좁은 저장 provider로 추출하는 것을 권장한다.

```text
@wake-surfer/realtime-chat-message-store
  message table contract
  stream sequence append primitive
  message row mapping

@wake-surfer/realtime-chat-message-send
  사용자 command/권한/clientMessageId 정책
  message-store 사용

@wake-surfer/realtime-chat-system-message
  외부 source 멱등성/시스템 content 정책
  message-store 사용
```

이는 단순 공용화가 아니라 사용자와 시스템 메시지가 반드시 공유해야 하는 sequence·message transaction 불변조건의 단일 소유자를 만드는 추출이다. 선행 PR 변경 폭 때문에 즉시 추출이 과도하면, 첫 구현에서 table contract와 internal append port만 공개하고 후속 이슈로 store를 분리할 수 있다. 단, SQL을 두 패키지에 복제하는 방식은 허용하지 않는다.

## 8. 채널 연동 검증

시스템 event는 사용자 write 권한 검사를 거치지 않는다. 대신 신뢰된 integration source와 target 일치 여부를 검증한다.

```ts
type CollaborationChatTargetResolver = (input: {
  workspaceId: string;
  channelId: string;
}) => Promise<
  | {
      status: "resolved";
      streamId: string;
      recipientActorIds: string[];
    }
  | {
      status: "retryable_not_ready";
    }
  | {
      status: "rejected";
      reason: "channel_not_found" | "workspace_channel_mismatch";
    }
>;
```

- channel이 이벤트의 workspace에 실제로 속하는지 확인한다.
- archived channel에 시작 메시지를 기록할지 제품 정책을 정한다.
- 이벤트와 channel projection 생성 순서가 뒤바뀔 수 있으면 `retryable_not_ready`를 제한 횟수로 재시도한다.
- `startedByActorId`가 지금 채널 멤버가 아니더라도 세션 provider가 이미 시작을 확정했다면 메시지 자체를 거절하지 않는 것을 권장한다.
- 테스트용 무조건 성공 resolver를 production 기본값으로 두지 않는다.

## 9. 수신자와 delivery 연계

시스템 메시지는 일반 메시지와 같은 `OutboundMessageDeliveryRequested`를 사용한다. 이를 위해 outbound message 계약이 system message union을 수용해야 한다.

수신자 정책:

- 이벤트 처리 시점에 해당 channel을 읽을 수 있는 actor를 API/권한 provider가 계산한다.
- `startedByActorId`도 현재 channel 수신자라면 포함한다.
- 시스템 메시지에는 sender가 없으므로 “sender 제외” 규칙을 적용하지 않는다.
- Gateway는 recipient membership을 다시 계산하지 않고 로컬 session만 찾는다.

멱등성 정책:

- 최초 `created`에 대해서만 delivery event를 발행한다.
- 동일 `SessionStarted` 재전달의 `existing` 결과는 delivery를 다시 발행하지 않는다.
- 최초 publish가 실패한 뒤 외부 event가 재전달돼도 이를 delivery retry로 사용하지 않는다.
- publish 실패 복구는 Flow 7 `afterSequence` 또는 향후 transactional outbox가 담당한다.

시스템 메시지의 실시간 event 이름은 사용자 메시지와 동일한 `chat.message.created`를 유지한다. 클라이언트는 `messageType`과 `content.type`으로 렌더링을 분기한다.

## 10. 예상 패키지와 파일

실제 이름은 메시지 PR과 Collaboration Session provider 머지 후 다시 확인한다.

### 외부 provider 공개 계약

```text
packages/collaboration-session-contracts/
  README.md
  public-docs/api.md
  src/index.ts
  test/session-events.test.ts
```

이 경로는 Collaboration Session 팀이 소유한다. Chat consumer는 공개 계약만 읽고 owner 문서나 내부 모델에 의존하지 않는다.

### 공통 message 계약과 저장 경계

```text
packages/realtime-chat-message-contracts/
  README.md
  src/index.ts
  test/public-message-contract.test.ts

packages/realtime-chat-message-store/
  README.md
  src/index.ts
  src/message-table.ts
  src/message-append.ts
  src/table-contract.ts
  test/message-append-postgres.integration.test.ts
```

현재 `realtime-chat-message-send-contracts`의 `PublicMessage`와 outbound event를 공통 계약으로 승격하고, user send 전용 request/response는 기존 계약 패키지에 남긴다.

### 신규 system message provider

```text
packages/realtime-chat-system-message/
  README.md
  package.json
  src/index.ts
  src/system-message-module.ts
  src/usecases/post-collaboration-session-started/post-system-message.usecase.ts
  src/usecases/post-collaboration-session-started/post-system-message.kysely.ts
  test/post-system-message-invariants.test.ts
  test/post-system-message-postgres.integration.test.ts
```

### 메시지 전송 provider 조정

- `packages/realtime-chat-message-send/src/message-send-module.ts`
- `packages/realtime-chat-message-send/src/usecases/send-message/*`
- `packages/realtime-chat-message-send/src/message-send-table.ts` 또는 새 store로 이동
- `packages/realtime-chat-message-send-contracts/src/index.ts`
- 관련 README와 테스트

### DB와 API runtime

- `packages/realtime-chat-database/src/realtime-chat-database.ts`
- 명시적 migration 파일 또는 현재 schema bootstrap 보강
- `apps/realtime-chat-api/src/runtime/collaboration-session-subscriber.ts` 신규
- `apps/realtime-chat-api/src/runtime/create-runtime-deps.ts`
- `apps/realtime-chat-api/src/main.ts`
- subscriber 종료/drain과 readiness 테스트
- `apps/realtime-chat-api/public-docs/runtime-contract.md`

외부 broker와 Flow 6 outbound bus가 같은 기술을 쓰더라도 inbound subscriber와 outbound publisher port를 하나의 거대한 event-bus abstraction으로 합치지 않는다.

### Gateway와 웹

Flow 6이 system message union을 그대로 relay할 수 있다면 Gateway 변경은 schema/contract 업데이트 정도다.

- `apps/realtime-chat-gateway`의 delivery event validator와 socket serializer
- `apps/web/src/features/chat/contracts.ts` 임시 미러 제거
- `apps/web/src/features/chat/useChatRoom.ts` 또는 외부 model
- `MessageBubble.tsx`의 system message 렌더링
- system content renderer와 테스트

## 11. DB 변화

현재 사용자 전용 `messages`를 판별 가능한 메시지 모델로 바꾼다.

권장 개념 schema:

```sql
ALTER TABLE messages
  ADD COLUMN message_type text NOT NULL DEFAULT 'user';

ALTER TABLE messages
  ALTER COLUMN sender_actor_id DROP NOT NULL,
  ALTER COLUMN client_message_id DROP NOT NULL;

ALTER TABLE messages
  ADD COLUMN content_json jsonb;

CREATE TABLE message_source_keys (
  source_context text NOT NULL,
  source_event_type text NOT NULL,
  source_entity_id text NOT NULL,
  source_event_id text NOT NULL,
  message_id text NOT NULL REFERENCES messages(message_id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (source_context, source_event_type, source_entity_id),
  UNIQUE (message_id)
);
```

최종 schema에는 다음 check constraint를 둔다.

- user message는 `sender_actor_id`와 `client_message_id`가 필수다.
- system message는 사용자 멱등성 키를 요구하지 않는다.
- 허용된 `message_type`과 `content_type`만 저장한다.
- source key가 가리키는 message는 system message여야 한다. DB constraint로 직접 표현하기 어렵다면 transaction use case와 통합 테스트로 보장한다.

`content_text`를 유지하면서 system 전용 열을 여러 개 추가하기보다 version 가능한 `content_json`을 권장한다. 다만 JSONB row parser는 content type별 strict runtime validation을 수행해야 한다. 기존 user text 데이터는 `{ "type": "text", "text": ... }`로 backfill한다.

현재 `CREATE TABLE IF NOT EXISTS` bootstrap은 기존 테이블 구조를 변경하지 못한다. PR이 합쳐진 뒤 개발 DB에도 테이블이 존재할 수 있으므로 다음 중 하나를 이슈에서 명시적으로 선택한다.

- 정식 versioned migration을 추가한다.
- 아직 비운영 단계임을 확인하고 개발 DB reset 절차와 완성된 신규 schema를 제공한다.

운영 데이터가 존재할 가능성이 있으면 reset을 가정하지 않는다.

## 12. 단계별 구현

1. Collaboration Session provider와 `SessionStarted` v1 공개 계약, delivery semantics를 확정한다.
2. 메시지 PR에서 stream append transaction, PublicMessage, outbound delivery 경계를 확인한다.
3. 공통 message DTO와 message store 추출 범위를 정하고 user send 동작을 회귀 테스트로 고정한다.
4. message schema를 user/system union과 source key table로 migration한다.
5. `realtime-chat-system-message`에 semantic idempotency, target resolver, structured content 생성 use case를 구현한다.
6. 실제 PostgreSQL에서 source key 경쟁과 user/system sequence 경쟁을 검증한다.
7. API runtime에 외부 event anti-corruption subscriber를 조립하고 ack/retry/dead-letter 분류를 구현한다.
8. 최초 created 결과를 기존 outbound delivery publisher에 연결한다.
9. Flow 6 Gateway와 웹 클라이언트가 system message union을 relay·렌더링하도록 계약을 갱신한다.
10. publish 실패 시 Flow 7 sync로 system message가 복구되는 통합 시나리오를 추가한다.
11. 확정된 계약과 owner context만 각 provider의 공개/내부 문서에 승격한다.

## 13. 중복·순서·실패 테스트

### 외부 계약과 anti-corruption 테스트

- 정상 `SessionStarted v1`이 내부 command로 정확히 매핑된다.
- `channelId` 없는 이벤트는 message 없이 `ignored(not_channel_scoped)`다.
- 알 수 없는 event version/type, 공백 식별자, 잘못된 시각을 거절한다.
- 외부 actor/displayName 필드를 sender로 복사하지 않는다.
- schema 오류는 retryable DB 오류와 구분돼 dead-letter/관측된다.

### 멱등성 단위 테스트

- 기존 source key fast path는 target resolve, sequence 증가, message insert, delivery를 호출하지 않는다.
- transaction 경쟁의 existing 결과는 delivery를 발행하지 않는다.
- 같은 session ID의 다른 event ID도 시스템 메시지 한 건으로 수렴한다.
- 같은 semantic key의 다른 channel payload는 최초 결과를 유지하고 conflict를 기록한다.
- `SessionStarted`와 향후 `SessionEnded`는 event type이 달라 별도 키를 가질 수 있다.

### PostgreSQL 경쟁 테스트

- 같은 `SessionStarted`를 동시에 N번 처리해 message 1건, source key 1건, sequence 증가 1회만 남는다.
- 같은 session ID가 잘못된 서로 다른 channel로 동시에 들어와도 전체 DB에서 한 건만 commit된다.
- user message와 system message를 같은 channel에 동시에 append하면 서로 다른 sequence를 가진다.
- source key 경쟁에서 진 transaction은 message와 sequence 증가를 모두 rollback한다.
- 외부 event 재전달은 최초 messageId, sequence, createdAt을 반환한다.
- migration 후 기존 user message 조회·멱등성이 유지된다.

### 순서 테스트

- stream sequence는 `occurredAt`이 아니라 DB commit 순서로 정렬된다.
- 늦게 도착한 `SessionStarted`도 현재 stream 끝에 append된다.
- `SessionEnded`가 먼저 도착하는 경우는 첫 이슈 범위에서 명시적으로 ignore/reject하며 시작 메시지를 임의로 합성하지 않는다.
- 실시간 user message 사이에 system message가 와도 클라이언트가 sequence대로 렌더링한다.

### delivery와 실패 테스트

- 최초 created system message만 recipient와 함께 delivery를 한 번 요청한다.
- 외부 event 중복 처리에서는 delivery를 다시 요청하지 않는다.
- publish 실패가 message/source key/sequence를 rollback하지 않는다.
- publish 실패 후 `afterSequence` sync에서 system message를 조회할 수 있다.
- DB commit 전 일시 오류는 broker message를 ack하지 않아 재시도된다.
- DB commit 성공 후 subscriber 응답이 유실돼 재전달돼도 idempotent no-op이다.
- target projection 미준비는 제한된 retry 후 관측 가능한 실패로 전환된다.

### E2E 테스트

1. channel에 수신자 WebSocket session을 연결한다.
2. 신뢰된 Collaboration source로 `SessionStarted`를 발행한다.
3. DB에 system message와 source key가 한 건 생성된다.
4. 수신자는 `chat.message.created`에서 구조화된 system message를 받는다.
5. 같은 이벤트를 다시 발행해도 DB와 UI에 추가 메시지가 없다.
6. user/system 혼합 timeline이 sequence 순으로 보인다.

## 14. 실패 기록과 관측성

구조화 로그와 지표에 다음 결과를 구분한다.

- `created`
- `existing_duplicate`
- `ignored_not_channel_scoped`
- `rejected_invalid_event`
- `rejected_target_mismatch`
- `retryable_target_not_ready`
- `retryable_persistence_failure`
- `delivery_publish_failed`
- `source_payload_conflict`

로그에는 `eventId`, `sessionId`, `workspaceId`, `channelId`, 생성된 `messageId`, `streamId`, `sequence`, 처리 결과와 소요 시간을 포함할 수 있다. message 표시 문구, ticket, 전체 recipient 목록은 남기지 않는다. metric label에는 개별 식별자를 사용하지 않는다.

subscriber readiness는 inbound broker 연결과 필수 contract/handler 조립 상태를 반영한다. shutdown 시 새 event 수신을 중단하고 진행 중 DB transaction이 끝날 유예 시간을 둔다.

## 15. 완료 조건

- 채널에 연결된 정상 `SessionStarted`가 system message 한 건을 만든다.
- 외부 DTO가 anti-corruption adapter 밖의 채팅 도메인 API로 새지 않는다.
- 동일 session start의 순차·동시 재전달이 message 한 건과 sequence 한 번으로 수렴한다.
- user/system 메시지가 같은 channel stream sequence와 append transaction을 공유한다.
- 시스템 메시지는 가짜 sender/clientMessageId 없이 저장된다.
- 최초 생성에만 recipient delivery가 요청된다.
- publish 실패 후에도 저장이 유지되고 Flow 7 sync로 조회된다.
- 실제 PostgreSQL 경쟁 테스트와 subscriber-to-client E2E가 통과한다.
- 확정된 공개 계약이 provider 문서에 반영되고 이 계획 `notes`는 agent route에 포함되지 않는다.

## 16. 비범위

- Collaboration Session 생성·참가·종료 상태 machine
- 화상 회의/WebRTC 또는 페어 프로그래밍 transport
- CurrentCollaborationSessionView projection
- Presence/typing/read cursor
- Flow 6 broker와 Gateway fan-out 본체
- Flow 7 stream sync 본체
- system message 편집·삭제
- 과거 이벤트 backfill
- 임의 관리자 공지 시스템
- 사용자 언어별 서버-side 문구 렌더링

## 17. SessionEnded 포함 여부

첫 이슈는 **`SessionStarted`만 포함**하는 것을 권장한다.

이유:

- 현재 Flow 10의 명시적 사용자 가치가 세션 시작 알림이다.
- 종료 메시지가 채팅 timeline에 필요한지 제품 결정이 없다.
- 종료 이벤트에는 종료 사유, 종료 주체, duration, 비정상 종료 표현 정책이 추가로 필요하다.
- `SessionEnded`가 `SessionStarted`보다 먼저 도착하거나 시작 이벤트가 유실된 경우의 정책이 필요하다.
- 짧은 세션이 많으면 시작/종료 시스템 메시지가 timeline을 과도하게 채울 수 있다.

다만 schema와 source key는 `source_event_type`을 포함해 후속 확장을 막지 않는다. `SessionEnded`를 같은 이슈에 포함하기로 결정하면 최소한 다음을 먼저 확정한다.

- 종료 메시지를 만들 session type과 최소 duration
- 정상 종료/강제 종료/장애 종료의 표현
- `endedByActorId`, `endReason`, `endedAt` 외부 계약
- start 없이 end만 온 경우 ignore, retry, 단독 end message 중 어느 정책인지
- sequence는 event occurredAt이 아니라 처리 commit 순서라는 사실을 UI가 허용하는지
- idempotency key `SYSTEM_MESSAGE:collaboration-session:SessionEnded:<sessionId>`

## 18. 위험과 미결정

### 결정 필요

- Collaboration Session provider와 공개 event contract의 실제 소유 패키지·버전 정책
- inbound transport와 ack/retry/dead-letter 제공 방식
- structured content를 client에서 지역화할지 server가 fallback text를 저장할지
- archived channel에 session start system message를 기록할지
- target projection 지연을 몇 번/얼마 동안 retry할지
- 공통 message store를 이 이슈에서 추출할지 선행 이슈로 분리할지
- 개발 DB reset이 허용되는지 정식 migration이 필요한지
- source payload conflict를 단순 관측할지 dead-letter로 격리할지

### 주요 위험

- 사용자 메시지 schema를 변경하면서 기존 멱등성 unique constraint를 깨뜨릴 수 있다.
- eventId만 멱등성 키로 쓰면 같은 session start가 새 event ID로 재발행될 때 중복된다.
- stream lock만 믿으면 서로 다른 channel을 가리키는 동일 source key 경쟁을 막지 못한다.
- 시스템 메시지를 user send API로 우회하면 권한, sender, ACK 의미가 왜곡된다.
- 외부 표시명을 text로 고정 저장하면 이름 변경·지역화·신뢰 경계 문제가 생긴다.
- 중복 event에서 delivery를 재발행하면 다중 Gateway/탭에서 중복 렌더링이 생긴다.
- inbound event와 outbound delivery가 같은 broker를 쓴다는 이유로 책임을 하나의 거대 adapter에 합치면 장애·재시도 의미가 섞인다.

## 19. 문서 경계 반영

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 배경 계획이다.
- Chat consumer는 Collaboration Session provider의 `README.md`와 `public-docs/api.md`만 읽는다.
- 시스템 메시지와 공통 message DTO 소비자는 각 realtime-chat provider의 공개 계약만 읽는다.
- anti-corruption mapping, transaction, migration, 테스트 전략은 provider `owner-docs`에 둔다.
- 전역 `notes`와 provider `notes`는 consumer agent route에서 제외한다.
- parent deny 아래 public path를 다시 여는 권한 구조는 사용하지 않는다.
