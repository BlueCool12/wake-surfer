# Flow 13 — Thread reply 전송 구현 계획

> **주의:** 이 문서는 현재 구현 계약이 아니라 GitHub 이슈 작성과 작업 브랜치 분리를 위한 사람용 구현 계획이다. 확정된 외부 계약은 각 provider의 `README.md`와 `public-docs/`에 별도로 반영해야 하며, 이 문서를 에이전트 기본 문맥이나 소비자 계약으로 사용하지 않는다.

## 1. 목적과 범위

사용자가 접근 가능한 channel root message에 첫 답글 또는 후속 답글을 보내면 별도 thread stream에 메시지를 저장하고, parent channel timeline에는 root의 thread summary를 반영한다.

이 Flow의 목표는 다음과 같다.

- root message와 parent stream 접근 권한을 검증한다.
- 현재 정책상 thread에 쓸 수 있는 actor만 reply를 저장한다.
- 첫 accepted reply 시 thread와 thread stream을 원자적으로 생성한다.
- thread reply는 channel과 독립적인 stream sequence와 멱등성 키를 가진다.
- channel timeline에는 reply 본문을 섞지 않고 root message의 reply summary만 노출한다.
- reply delivery와 thread sync가 기존 실시간 채팅 경계를 재사용한다.
- ACK 유실, 동시 첫 reply, 중복 재시도에서도 message와 reply count가 한 번만 증가한다.

MVP 계획은 channel message를 root로 하는 thread를 우선한다. DM thread까지 같은 이슈에 포함할지는 제품 범위가 확정된 뒤 결정한다.

## 2. 현재 상태

현재 작업트리에는 thread backend package, thread table, API endpoint, Gateway event handler, 웹 thread UI가 없다.

브랜치 전환 없이 확인한 로컬 `feat/26-message-send`에는 다음 thread 관련 뼈대가 있다.

- 공개 target union에 `{ type: "thread", threadId }`가 있다.
- 기본 target resolver가 `thread:<threadId>` stream ID를 만든다.
- user message의 content validation, clientMessageId 멱등성, stream lock, sequence 발급, delivery 요청을 공통 처리한다.
- `messages`에 `target_type`과 `target_id`가 있어 thread target row를 저장할 수 있다.

하지만 이 구현은 thread 제품 정책을 제공하지 않는다.

- `threadId`와 `rootMessageId` 관계가 없다.
- root message 조회와 nested thread 방지가 없다.
- thread 생성 시점과 동시 생성 규칙이 없다.
- parent channel 읽기/쓰기 권한이 연결돼 있지 않다.
- recipient 계산은 기본 resolver에서 빈 배열이다.
- reply count, last reply 같은 channel timeline projection이 없다.
- thread sync와 read cursor가 없다.

따라서 메시지 PR의 generic `thread` target은 저장 파이프라인 확장점으로만 보고 Flow 13 구현 완료로 판단하지 않는다.

## 3. 핵심 도메인 모델

권장 모델은 다음과 같다.

```text
Channel stream
  └─ Root message
       └─ Thread
            └─ Thread stream
                 ├─ Reply sequence 1
                 ├─ Reply sequence 2
                 └─ Reply sequence 3
```

root message는 parent channel stream에 그대로 남는다. thread stream에 root를 복제하거나 sequence 0/1로 저장하지 않는다. thread 화면은 root message와 thread reply page를 조합해 보여준다.

```ts
type MessageThread = {
  threadId: string;
  rootMessageId: string;
  parentStreamId: string;
  threadStreamId: string;
  replyCount: number;
  lastReplyMessageId?: string;
  lastReplySequence: number;
  lastRepliedAt?: string;
  createdAt: string;
};
```

불변조건:

- root message 하나에는 thread가 최대 하나다.
- thread 하나에는 thread stream이 정확히 하나다.
- nested thread는 만들지 않는다. thread reply를 다시 root로 사용할 수 없다.
- `replyCount`는 해당 thread stream의 저장된 reply 수와 일치한다.
- `lastReplySequence`는 thread stream의 `last_sequence`와 일치한다.
- channel stream sequence와 thread stream sequence는 서로 독립적이다.

## 4. root message 접근 권한

thread reply 처리 전에 root를 서버에서 조회해 다음을 확인한다.

- root message가 존재한다.
- root가 `target_type = channel`인 parent channel message다.
- root가 thread reply가 아니므로 nested thread가 아니다.
- 삭제·차단·reply 금지 상태가 아니다. 삭제 기능이 아직 없으면 확장 포인트만 둔다.
- parent channel이 요청의 workspace/tenant 경계와 일치한다.
- actor가 parent channel stream을 읽을 수 있다.

root 조회 결과의 권장 내부 형태:

```ts
type ThreadRootResolution =
  | {
      status: "resolved";
      rootMessageId: string;
      parentStreamId: string;
      channelId: string;
      rootAuthorActorId: string;
      existingThread?: {
        threadId: string;
        threadStreamId: string;
      };
    }
  | {
      status: "unavailable";
    };
```

존재하지 않는 root와 읽기 권한이 없는 root는 외부에 동일한 `thread_unavailable`로 노출해 message 존재 여부를 탐색하지 못하게 한다.

## 5. thread write 권한

root read 권한과 reply write 권한은 별도 판단이다.

```ts
type ThreadReplyAuthorizer = (input: {
  actorId: string;
  rootMessageId: string;
  parentStreamId: string;
  channelId: string;
  threadId?: string;
}) => Promise<
  | { status: "allowed" }
  | { status: "denied"; reason: "write_forbidden" }
>;
```

MVP 권장 정책:

- actor가 parent channel을 읽을 수 있어야 한다.
- actor가 parent channel에 새 메시지를 쓸 수 있어야 한다.
- archived/read-only channel에서는 새 reply를 거절한다.
- private channel 비멤버는 거절한다.
- root 작성자라는 이유만으로 별도 권한을 주지 않는다.
- thread를 mute/close/lock하는 기능은 MVP 비범위다.

Gateway는 session 존재와 payload 형태만 확인한다. membership, archived 상태, root 접근은 API 권한 provider가 판단한다.

Flow 5와 같은 ACK 복구를 위해 이미 accepted된 `(actorId, threadStreamId, clientMessageId)`가 있으면 현재 write 권한이 철회됐더라도 기존 accepted 결과를 반환하는 것을 권장한다. 기존 reply 반환은 새 쓰기가 아니며 최초 처리 사실의 복구다.

## 6. thread 생성 시점

MVP에서는 **첫 accepted reply와 함께 lazy creation**한다.

- 사용자가 thread panel을 열기만 해서는 DB thread row를 만들지 않는다.
- 빈 thread는 존재하지 않는다.
- 별도 `CreateThread` command를 먼저 호출하지 않는다.
- 첫 reply transaction 안에서 thread metadata, thread stream, reply message를 함께 commit한다.

공개 send 요청에는 `rootMessageId`만 필수로 받고 `threadId`는 서버가 반환하는 것을 권장한다.

```ts
type ReplyThreadMessageRequest = {
  commandId?: string;
  rootMessageId: string;
  clientMessageId: string;
  content: { type: "text"; text: string };
  sentAtClient?: string;
};
```

최초 요청에서 client가 `threadId`를 임의 생성하게 하면 동일 root에 여러 thread ID가 경쟁할 수 있다. 후속 reply도 root ID 계약을 유지하면 client가 root/thread ID 일치 여부를 잘못 조합할 여지가 줄어든다. thread 전용 URL이나 API가 `threadId`를 쓰는 경우 서버가 `threadId → root`를 조회하고 일치를 보장한다.

### 동시 첫 reply

transaction lock 순서를 고정한다.

1. root message row를 `FOR UPDATE`로 잠근다.
2. `message_threads.root_message_id`를 조회한다.
3. 없으면 server-generated `threadId`, `threadStreamId`로 thread stream과 metadata를 생성한다.
4. thread stream row를 잠근다.
5. idempotency를 다시 확인하고 reply sequence를 발급한다.
6. reply insert와 thread summary 갱신을 commit한다.

`UNIQUE (root_message_id)`가 최종 안전망이다. 모든 thread reply writer가 `root → thread stream` 순서로 lock해 deadlock 가능성을 줄인다.

## 7. 별도 thread stream과 sequence

thread reply는 parent channel stream이 아니라 별도 stream에 저장한다.

```text
channel:ch-1       sequence 100  root message
thread:thread-123  sequence 1    first reply
thread:thread-123  sequence 2    second reply
channel:ch-1       sequence 101  next channel message
```

이 설계의 의미:

- reply를 보냈다고 channel `last_sequence`가 증가하지 않는다.
- channel timeline의 afterSequence sync에 reply 본문이 섞이지 않는다.
- thread panel은 thread stream의 afterSequence를 별도로 사용한다.
- `messageId`는 전역 고유하고 sequence는 stream 안에서만 의미가 있다.

현재 메시지 PR의 `thread:<threadId>` 형식을 유지할 수 있지만, string 형식은 public contract가 아니라 server-owned resolver 구현으로 둔다. client는 opaque `threadStreamId`를 사용한다.

## 8. thread reply 멱등성

사용자 reply의 멱등성 키는 기존 메시지 send 규칙을 재사용한다.

```text
(senderActorId, threadStreamId, clientMessageId)
```

보장할 결과:

- 재시도는 새 reply를 만들지 않는다.
- thread sequence를 새로 발급하지 않는다.
- `replyCount`를 다시 증가시키지 않는다.
- `lastReplyMessageId`, `lastReplySequence`, `lastRepliedAt`을 재갱신하지 않는다.
- delivery를 다시 요청하지 않는다.
- 최초 `messageId`, `threadId`, `threadStreamId`, `sequence`, `createdAt`을 반환한다.

첫 reply의 중복 요청에서는 lazy thread creation과 reply insert가 같은 transaction 안에 있으므로 thread row도 하나만 남아야 한다.

현재 메시지 PR의 stream lock·기존 message 재조회·`created | existing` 결과를 재사용한다. 다만 reply summary update는 `created` 분기 안에서 message insert와 같은 transaction으로 수행해야 한다. use case 밖에서 count를 증가시키면 ACK 유실 재시도와 crash 시 불일치가 생긴다.

## 9. channel timeline과 thread reply projection

channel timeline에는 root message만 일반 위치에 표시하고 reply는 root의 summary로 투영한다.

```ts
type ThreadSummary = {
  threadId: string;
  threadStreamId: string;
  replyCount: number;
  lastReplyMessageId: string;
  lastReplySequence: number;
  lastRepliedAt: string;
};
```

channel message 조회 DTO는 root에 선택적 `threadSummary`를 포함하거나 별도 summary map을 반환한다. reply 본문을 channel history message 배열에 넣지 않는다.

`message_threads` row를 projection이자 write-side invariant로 사용한다.

- reply insert와 `reply_count + 1`을 같은 transaction에서 처리한다.
- `last_reply_*`를 새 reply 값으로 갱신한다.
- 중복 reply에서는 갱신하지 않는다.
- channel reload/sync는 이 row를 join 또는 batch query해 정확한 summary를 복구한다.

실시간 MVP에서는 thread reply delivery를 받은 channel client가 root summary를 갱신할 수 있다. 별도 `chat.thread.summary.updated` event는 전체 channel에 reply content를 보내지 않는 최적화 단계에서 검토한다.

## 10. recipient 계산과 delivery

MVP recipient 정책은 **현재 parent channel을 읽을 수 있는 actor 전체**를 권장한다.

- reply message의 target은 thread stream이므로 client는 channel timeline에 본문을 append하지 않는다.
- thread panel이 열려 있으면 reply 목록에 append한다.
- channel 화면에서는 같은 event로 root summary를 갱신한다.
- privacy는 parent channel read 권한과 동일하다.

이 방식은 단순하고 기존 `OutboundMessageDeliveryRequested` 하나를 재사용하지만 큰 channel에서 fan-out 비용이 생긴다. 후속 최적화에서는 다음처럼 분리할 수 있다.

- full reply recipients: reply author, root author, thread 참여자, 구독자, mention 대상
- summary recipients: parent channel 현재 session 또는 channel 전체

첫 이슈에서 구독·mention 모델이 없다면 빈 recipient나 임의의 참여자 추정을 사용하지 않는다. parent channel membership provider가 recipient를 계산한다.

delivery 규칙:

- 최초 `created` reply만 발행한다.
- `existing` 멱등 재시도는 발행하지 않는다.
- publish 실패는 저장과 accepted를 롤백하지 않는다.
- publish 실패는 Flow 7 thread stream sync와 channel summary 재조회로 복구한다.

## 11. thread sync

Flow 7의 `SyncStream` 계약을 thread stream에도 적용한다.

- thread panel 최초 진입: root + thread metadata 조회 후 `afterSequence=0` sync
- 재접속: 저장된 thread `lastSeenSequence` 이후 sync
- sequence gap 감지: 마지막 연속 sequence부터 sync
- page와 `syncUpperBound` 규칙은 channel과 동일
- 권한은 thread 자체가 아니라 root parent stream 접근 권한에서 파생

thread root 조회 응답의 권장 형태:

```ts
type ThreadView = {
  threadId: string;
  threadStreamId: string;
  rootMessage: PublicMessage;
  summary: ThreadSummary;
};
```

channel stream sync는 thread reply를 반환하지 않는다. 대신 root message를 반환할 때 최신 summary를 붙이거나 summary query를 별도로 실행한다.

publish 실패 후 사용자가 thread panel을 열면 thread sync로 reply 본문을 복구한다. channel root의 reply count는 channel 재조회 또는 별도 summary event/query로 복구한다.

## 12. 예상 패키지와 파일

실제 이름은 메시지 PR과 Flow 7 계약 머지 후 다시 확인한다.

### 신규 계약 provider

```text
packages/realtime-chat-thread-reply-contracts/
  README.md
  package.json
  src/index.ts
  test/thread-reply-contract.test.ts
```

소유 계약:

- `ReplyThreadMessageRequest`
- accepted/rejected result와 reason
- `ThreadView`, `ThreadSummary`
- thread reply public message target/context
- WebSocket request/response schema

공통 `PublicMessage`는 message 계약 provider에서 가져오고 중복 정의하지 않는다.

### 신규 thread reply provider

```text
packages/realtime-chat-thread-reply/
  README.md
  package.json
  src/index.ts
  src/thread-reply-module.ts
  src/thread-table.ts
  src/table-contract.ts
  src/usecases/reply-thread-message/reply-thread-message.usecase.ts
  src/usecases/reply-thread-message/reply-thread-message.kysely.ts
  src/usecases/get-thread-view/get-thread-view.usecase.ts
  test/thread-reply-invariants.test.ts
  test/thread-reply-postgres.integration.test.ts
```

### 메시지 저장/전송 provider 연계

- `packages/realtime-chat-message-send`의 공개 append 경계 또는 Flow 10에서 추출하는 `realtime-chat-message-store`
- `packages/realtime-chat-message-send-contracts`의 thread target/public message 조정
- `packages/realtime-chat-database/src/realtime-chat-database.ts`

SQL을 thread package에 복제해 sequence 발급 규칙을 이원화하지 않는다. 두 번째/세 번째 message writer가 생기는 시점에는 stream append primitive의 단일 소유자가 필요하다.

### API와 Gateway

- `apps/realtime-chat-api/src/app.ts`
- `apps/realtime-chat-api/src/runtime/create-runtime-deps.ts`
- thread reply 내부 endpoint와 root/thread query endpoint
- `apps/realtime-chat-api/test/app-smoke.test.ts`
- `apps/realtime-chat-api/public-docs/runtime-contract.md`
- `apps/realtime-chat-gateway/src/app.ts` 또는 분리된 thread handler
- `apps/realtime-chat-gateway/src/runtime/realtime-chat-api-client.ts`
- Gateway API client/smoke 테스트
- `apps/realtime-chat-gateway/public-docs/runtime-contract.md`

### 웹

- 실제 ChatTransport의 `sendThreadReply`, `loadThread`, `syncThread`
- thread panel model과 stream별 cursor
- root message의 reply count/last reply 렌더링
- thread reply 낙관적 UI와 `clientMessageId` 재시도
- `MessageBubble.tsx`의 “답글 N개” 진입점

## 13. DB 변화

신규 `message_threads` table을 권장한다.

```sql
CREATE TABLE message_threads (
  thread_id text PRIMARY KEY,
  root_message_id text NOT NULL UNIQUE REFERENCES messages(message_id),
  parent_stream_id text NOT NULL REFERENCES message_streams(stream_id),
  thread_stream_id text NOT NULL UNIQUE REFERENCES message_streams(stream_id),
  reply_count integer NOT NULL DEFAULT 0,
  last_reply_message_id text NULL REFERENCES messages(message_id),
  last_reply_sequence integer NOT NULL DEFAULT 0,
  last_replied_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (reply_count >= 0),
  CHECK (last_reply_sequence >= 0)
);

CREATE INDEX message_threads_parent_stream_idx
  ON message_threads (parent_stream_id);
```

생성 순서에서 `thread_stream_id` FK가 필요하므로 transaction 안에서 server-generated ID를 만든 뒤 `message_streams` row를 먼저 insert하고 `message_threads`를 insert한다.

기존 `messages` table은 thread reply를 `target_type = thread`, `target_id = thread_id`, `stream_id = thread_stream_id`로 저장할 수 있다. 다음 불변조건은 use case와 통합 테스트로 보장한다.

- thread target의 message stream은 metadata의 `thread_stream_id`와 같다.
- root message는 parent stream에 속한다.
- reply count와 last reply sequence가 thread stream의 실제 상태와 일치한다.

현재 bootstrap이 `CREATE TABLE IF NOT EXISTS` 기반이므로 schema 변경 방식을 명시한다. 운영 데이터가 있다면 versioned migration이 필요하다.

## 14. 공개 계약

### WebSocket 요청

```json
{
  "type": "chat.thread.reply.send",
  "commandId": "cmd-1",
  "rootMessageId": "msg-root-1",
  "clientMessageId": "local-reply-1",
  "content": {
    "type": "text",
    "text": "답글입니다"
  }
}
```

Gateway는 actor ID를 session에서 주입한다. client가 actor, stream ID, recipient를 지정하지 못한다.

### accepted

기존 `chat.message.accepted` event를 재사용하되 reply context를 포함한다.

```ts
type ThreadReplyAccepted = {
  status: "accepted";
  commandId?: string;
  clientMessageId: string;
  message: PublicMessage;
  thread: {
    threadId: string;
    rootMessageId: string;
    parentStreamId: string;
    threadStreamId: string;
    summary: ThreadSummary;
  };
};
```

### rejected

권장 외부 reason:

- `invalid_content`
- `thread_unavailable`
- `write_forbidden`
- `root_not_replyable`

`root_not_found`와 `root_access_denied`를 외부에서 구분하지 않는다. API timeout/5xx는 도메인 rejected가 아니라 재시도 가능한 transport/server failure다.

## 15. 단계별 구현

1. MVP root 범위를 channel message로 확정하고 DM/system/deleted root 정책을 기록한다.
2. 메시지 PR의 thread placeholder, append transaction, idempotency, public message 계약을 확인한다.
3. thread reply 계약 패키지에 request/accepted/rejected/thread view/summary schema를 정의한다.
4. `message_threads` migration과 table contract를 추가한다.
5. root resolver와 read/write permission port를 구현한다.
6. lazy thread creation, stream append, summary update를 하나의 transaction으로 구현한다.
7. 실제 PostgreSQL에서 동시 첫 reply, 중복 reply, user/thread sequence 독립성을 검증한다.
8. parent channel recipient 계산과 outbound delivery를 연결한다.
9. API/Gateway에 `chat.thread.reply.send` relay와 thread view/sync 경계를 조립한다.
10. 웹에 thread panel, 낙관적 reply, summary update, thread cursor를 구현한다.
11. publish 실패 후 thread sync와 channel summary 재조회 복구를 검증한다.
12. 확정된 계약만 각 provider 공개 문서와 owner context에 승격한다.

## 16. 테스트 계획

### 단위 테스트

- root unavailable이면 권한·append·delivery를 호출하지 않는다.
- root read denied와 root missing이 같은 외부 reason이다.
- root read allowed지만 write denied이면 저장하지 않는다.
- thread reply를 root로 보내면 `root_not_replyable`이다.
- 기존 accepted reply fast path는 현재 write 권한 검사와 summary update를 건너뛴다.
- content validation과 `clientMessageId` validation이 기존 send 규칙과 일치한다.
- 최초 created만 delivery를 요청한다.
- delivery publish 실패에도 accepted가 유지된다.

### PostgreSQL 통합 테스트

- 첫 reply가 thread row, thread stream, reply message를 함께 만든다.
- 같은 root의 동시 첫 reply N개가 thread 하나를 만들고 서로 다른 연속 sequence를 가진다.
- 동일 actor/thread/clientMessageId 동시 요청은 reply 한 건, sequence 증가 한 번, replyCount 증가 한 번이다.
- 서로 다른 clientMessageId의 동시 reply는 각각 저장되고 replyCount가 정확하다.
- 같은 clientMessageId라도 다른 actor 또는 다른 thread면 별도 저장 가능하다.
- thread reply가 parent channel `last_sequence`를 변경하지 않는다.
- 서로 다른 root thread는 각각 sequence 1부터 시작한다.
- 실패한 transaction은 빈 thread, 고아 stream, 증가한 count를 남기지 않는다.
- `last_reply_*`와 실제 마지막 reply가 일치한다.
- `(root_message_id)`와 `(thread_stream_id)` 유일 제약이 경쟁을 막는다.

### API/Gateway 통합 테스트

- actor는 Gateway session에서 주입되고 body의 actor/recipient/streamId 필드는 거절된다.
- rootMessageId와 clientMessageId가 API까지 의미 변경 없이 전달된다.
- accepted가 thread ID, stream ID, sequence, summary를 보존한다.
- 권한 거절이 적절한 WebSocket rejected event로 relay된다.
- API timeout/5xx가 영구 도메인 rejected로 변환되지 않는다.

### sync/projection 통합 테스트

- channel sync에는 reply 본문이 없고 root summary가 최신이다.
- thread sync에는 root를 제외한 reply만 sequence 오름차순으로 있다.
- publish 실패한 reply를 thread `afterSequence`로 복구한다.
- 실시간 reply와 sync 결과가 겹쳐도 `messageId`로 한 번만 표시한다.
- 중복 retry가 summary count를 늘리지 않는다.

### E2E 테스트

1. 두 사용자가 같은 channel에 접속한다.
2. root message에서 첫 reply를 보낸다.
3. sender는 accepted를 받고 두 client는 root의 reply count 1을 본다.
4. thread panel을 열면 root와 reply sequence 1을 본다.
5. 같은 `clientMessageId`로 재시도해도 count와 reply가 늘지 않는다.
6. 두 사용자가 동시에 reply해 thread sequence와 count가 정확하다.
7. 접근 권한 없는 사용자는 root/thread 존재를 식별할 수 없다.

## 17. MVP thread read cursor 선택

MVP에서는 **서버 영속 thread ReadCursor를 만들지 않는 것**을 권장한다.

- thread stream은 sync를 위해 client-side `lastSeenSequence`를 유지한다.
- channel ReadCursor는 channel stream sequence만 다루며 thread reply로 이동하지 않는다.
- thread reply unread badge/개수는 첫 이슈에서 제공하지 않는다.
- thread panel 진입 시 저장된 local cursor 또는 0부터 sync한다.
- channel root에는 reply count와 last reply 시각만 표시한다.

channel과 thread는 서로 다른 sequence 공간이므로 channel cursor에 thread sequence를 섞으면 안 된다. 후속 unread 요구가 생기면 `ReadCursor(userId, threadStreamId, lastReadSequence)`를 별도로 추가한다.

서버 thread read cursor를 첫 이슈에 포함하기로 결정하면 Flow 8과 함께 다음을 먼저 확정한다.

- thread 구독자와 unread 대상
- channel을 읽는 행위가 thread도 읽음 처리하는지
- root author/mention 사용자에게만 unread를 만들지
- thread cursor 저장과 unread projection transaction/이벤트 경계

## 18. 완료 조건

- 접근·쓰기 권한이 있는 actor의 첫 reply가 thread와 stream을 원자적으로 생성한다.
- root당 thread가 하나이며 nested thread가 생성되지 않는다.
- thread sequence가 parent channel과 독립적으로 증가한다.
- 같은 멱등성 키의 순차·동시 재시도가 reply/sequence/summary를 한 번만 변경한다.
- channel timeline에는 reply 본문이 섞이지 않고 정확한 thread summary가 보인다.
- recipient 계산, delivery, Flow 7 thread sync가 연결된다.
- 실제 PostgreSQL 경쟁 테스트와 API/Gateway/웹 E2E가 통과한다.
- 확정된 공개 계약이 provider 문서에 반영되고 이 계획 `notes`는 agent route에 포함되지 않는다.

## 19. 비범위

- nested thread
- thread reply 편집·삭제
- thread lock/close/mute
- mention과 notification preference
- 고급 thread 구독자 모델
- server-side thread unread/read cursor
- DM thread와 system message thread를 제품 결정 없이 자동 포함
- reply를 channel timeline의 일반 message로 복제
- full-text search와 thread archive
- Flow 6 broker/fan-out 본체
- Flow 7 sync 본체

## 20. 위험과 미결정

### 결정 필요

- MVP root를 user channel message로만 제한할지 system message도 허용할지.
- DM message root thread를 같은 이슈에 포함할지.
- archived channel에서 기존 thread reply를 허용할지.
- 첫 요청에서 rootMessageId만 받을지, 후속 요청에 threadId도 허용할지.
- full reply를 channel member 전체에 fan-out할지 thread 참여자/구독자로 좁힐지.
- channel 실시간 summary를 reply event로 갱신할지 별도 summary event를 만들지.
- Flow 10의 공통 message store 추출과 이 이슈의 선후 관계.
- root 삭제가 도입될 때 기존 thread 보존·조회 정책.

### 주요 위험

- root lock과 thread stream lock 순서가 writer마다 다르면 deadlock이 생길 수 있다.
- reply insert와 summary update가 다른 transaction이면 count가 실제 reply와 어긋난다.
- parent channel sequence를 reply마다 올리면 channel/thread 두 timeline 의미가 섞인다.
- 가장 큰 수신 thread sequence를 연속성 확인 없이 cursor로 저장하면 gap을 영구 누락한다.
- channel 전체에 full reply를 보내는 MVP 정책은 큰 channel에서 대역폭 비용이 커질 수 있다.
- root not found와 permission denied를 구분해 응답하면 private message 존재 여부가 노출될 수 있다.
- generic message-send target만 믿고 root/thread metadata를 만들지 않으면 고아 thread stream이 생길 수 있다.

## 21. 문서 경계 반영

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 배경 계획이다.
- thread reply 소비자는 `realtime-chat-thread-reply-contracts/README.md`와 public contract만 읽는다.
- root 권한, lazy creation, lock 순서, projection, 테스트 전략은 thread provider `owner-docs`에 둔다.
- message store와 stream sync는 각각의 공개 계약만 dependency route에 노출한다.
- 전역 `notes`와 provider `notes`는 consumer agent route에서 제외한다.
- parent deny 아래 public path를 다시 여는 권한 구조는 사용하지 않는다.
