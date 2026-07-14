# Flow 12 DM 메시지 전송 구현 계획

> 상태: 이 문서는 이슈와 작업 브랜치를 만들기 위한 구현 계획이다. 현재 구현 계약이나 확정된 공개 API가 아니다.
> 구현 중 확정된 계약은 해당 provider의 `README.md`, `public-docs/`, `owner-docs/`로 승격하고 이 문서를 agent context route에 포함하지 않는다.

## 1. 목적과 범위

인증된 사용자가 자신이 참여 중인 1:1 또는 Group DM에 메시지를 보내고, 채널 메시지와 같은 저장·sequence·멱등성 파이프라인을 사용하면서 DM 고유의 대화 생성과 참여자 권한을 보장한다.

이 계획이 다루는 흐름은 다음과 같다.

```text
1:1 DM 열기 또는 Group DM 생성
→ DMConversation과 participant 저장
→ Client가 기존 dmConversationId를 대상으로 메시지 전송
→ Gateway가 transport 계약 검증과 session actor 주입
→ API가 DM 존재와 active participant 권한 확인
→ DM stream에서 sequence 발급과 메시지 멱등 저장
→ sender accepted 반환
→ active participant snapshot으로 outbound delivery 발행
→ offline/누락 수신자는 SyncStream으로 복구
```

`SendDMMessage`가 임의 대상 사용자를 받아 대화를 암묵적으로 만드는 방식은 사용하지 않는다. `OpenDirectMessage`와 `CreateGroupDM`이 대화 생성을 소유하고, 메시지 전송은 이미 존재하는 `dmConversationId`만 받는다.

## 2. 현재 상태

### 2.1 현재 작업트리

- 기준 작업트리에는 Gateway ticket과 WebSocket 연결 인증만 구현되어 있다.
- API/Gateway 앱에는 메시지 command route와 WebSocket envelope relay가 아직 없다.
- DMConversation, participant, DM 생성 command, DM 목록/read model은 없다.
- Flow 6 outbound fan-out과 Flow 7 stream sync도 현재 작업트리에는 없다.
- 공통 DB에는 gateway ticket table만 조립되어 있다.

### 2.2 브랜치 전환 없이 확인한 메시지 PR

머지된 PR #28의 로컬 브랜치 `feat/26-message-send`를 `git show`로 확인했다. 다음 기반을 제공한다.

- `SendMessageTarget`에 `{ type: "dm", dmConversationId }`가 이미 있다.
- `SendMessageRequestBodySchema`는 channel/DM/thread target을 하나의 command 계약으로 검증한다.
- `MessageTargetResolver`가 `streamId`와 `recipientActorIds`를 반환한다.
- `MessageWriteAuthorizer`가 쓰기 권한 port를 제공한다.
- `message_streams`가 target별 stream과 `last_sequence`를 소유한다.
- `messages`가 `(stream_id, sequence)`와 `(sender_actor_id, stream_id, client_message_id)` unique 조건을 가진다.
- stream row lock 뒤 sequence를 증가시키고 메시지를 저장한다.
- 최초 저장에만 `OutboundMessageDeliveryRequested`를 발행하며 발행 실패가 accepted를 rollback하지 않는다.

하지만 DM의 존재, participant, 1:1 중복, Group DM 인원 제한은 의도적으로 구현하지 않았다. 특히 기본 `createDefaultMessageTargetResolver()`는 `dm:<dmConversationId>`를 그대로 만들고 수신자를 빈 배열로 반환한다. 운영 DM wiring에서 이를 사용하면 임의 DM ID 저장과 무배달이 가능하므로 반드시 DM 전용 resolver/policy로 교체해야 한다.

또한 현재 `sendMessage()`는 target resolution 뒤 기존 멱등 메시지를 조회하고, 그 다음 `authorizeWrite`를 호출한다. DM resolver가 participant 여부를 검증하지 않고 authorizer에만 맡기면 탈퇴한 사용자가 과거 `clientMessageId`로 기존 accepted 결과를 조회할 수 있다. DM target resolution 단계부터 존재와 참여 권한을 fail-closed로 확인해야 하며, 탈퇴 정책을 구현할 때 이 순서를 다시 검토한다.

## 3. 채널 메시지 slice에서 재사용할 것과 분리할 것

### 3.1 재사용할 것

- `SendMessageRequest`, `SendMessageResponse`, `PublicMessage`의 공통 계약
- `SendMessageTarget`의 DM variant
- content validation과 공통 메시지 크기 상한
- `clientMessageId` 멱등성
- `message_streams` stream row lock과 sequence 증가
- `messages` 저장과 `PublicMessage` mapping
- 동시 요청의 unique 충돌 복구
- 최초 저장일 때만 outbound delivery 발행
- 저장 성공과 실시간 delivery 성공 분리
- Gateway의 JSON/envelope/크기/session 검증
- `chat.message.accepted`, `chat.message.rejected`, `chat.message.created`
- Flow 6 local session fan-out과 Flow 7 `SyncStream(afterSequence)`

DM이라고 별도 messages table, 별도 sequence 알고리즘, 별도 ACK DTO를 만들지 않는다.

### 3.2 분리할 것

- `DMConversation` 생성·조회와 lifecycle
- 1:1 participant pair canonicalization과 중복 방지
- Group DM 참여자 수·중복·creator 포함 정책
- participant 저장과 active membership 조회
- DM target을 stream으로 resolve하는 adapter
- 읽기·쓰기 권한과 외부 오류 은닉 정책
- participant snapshot에서 `recipientActorIds` 계산
- DM 목록/제목/참여자 projection
- 탈퇴·재초대·과거 메시지 접근 정책

이 책임은 `realtime-chat-message-send`에 조건문으로 쌓지 않고 DMConversation provider가 소유한다. 메시지 send slice는 공개 port를 통해 DM을 resolve한다.

## 4. DMConversation과 participant 권한

### 4.1 모델

```text
DMConversation
  dmConversationId
  type: ONE_TO_ONE | GROUP
  createdByActorId
  createdAt

DMParticipant
  dmConversationId
  actorId
  joinedAt
  invitedByActorId?
  leftAt?                 // leave를 구현할 때만 의미 확정
```

불변조건은 다음과 같다.

- 1:1 DM은 서로 다른 정확히 2명의 active participant를 가진다. self DM은 허용하지 않는다.
- Group DM은 creator를 포함해 서로 다른 3명 이상 10명 이하의 active participant를 가진다.
- client가 보내는 actor ID가 아니라 인증 context의 actor가 creator/sender다.
- 메시지 전송 시 actor가 active participant가 아니면 stream을 resolve하지 않는다.
- 읽기와 `SyncStream`도 같은 active participant policy를 사용한다.
- 메시지 전송 요청의 recipient 목록은 client에서 받지 않는다.
- participant 존재와 수신자 snapshot은 API가 기준 DB에서 계산한다.

### 4.2 외부 오류와 정보 노출

존재하지 않는 DM과 참여하지 않은 DM을 외부 응답에서 모두 `target_not_found`로 합칠 것을 권장한다. 임의 ID probe로 DM 존재를 알아내지 못하게 하기 위해서다. 내부 로그·metric은 `DM_NOT_FOUND`, `DM_PARTICIPANT_NOT_ACTIVE`를 구분할 수 있다.

Group DM 생성은 잘못된 인원 수, 중복 actor, self/creator 처리 오류, 존재하지 않는 actor를 명시적 생성 거절로 반환할 수 있다. 이는 이미 알고 있는 입력 검증 결과이므로 DM 존재 은닉과 다르다.

### 4.3 권한 검사 시점

`ResolveDMMessageTarget(actorId, dmConversationId)`는 한 번의 기준 DB 조회 또는 하나의 transaction snapshot에서 다음을 함께 반환한다.

```ts
{
  status: "resolved";
  streamId: string;
  recipientActorIds: string[];
}
```

- conversation이 존재한다.
- actor가 active participant다.
- active participant 수가 conversation type 불변조건 안에 있다.
- recipient 목록은 중복이 없고 actor ID namespace가 Gateway session과 같다.

`MessageWriteAuthorizer`는 block/suspension 같은 추가 정책이 있다면 별도로 유지한다. DM participant 검사를 authorizer에만 두지 않는다.

## 5. 1:1 중복 방지와 Group DM 최대 10명

### 5.1 1:1 DM

`OpenDirectMessage(targetActorId)`는 authenticated actor와 target actor의 canonical pair를 만든다. 동일한 두 actor가 반대 순서로 동시에 요청해도 하나의 `dmConversationId`만 반환해야 한다.

애플리케이션의 선조회만으로 중복을 막지 않는다. PostgreSQL unique constraint가 최종 보장을 맡는다.

권장 모델은 `dm_conversations`의 1:1 전용 canonical columns와 partial unique index다.

```sql
direct_actor_low_id  text NULL,
direct_actor_high_id text NULL

UNIQUE (direct_actor_low_id, direct_actor_high_id)
WHERE conversation_type = 'ONE_TO_ONE'
```

canonical ordering은 모든 호출자가 임의 locale sort를 쓰지 않고 하나의 함수 또는 PostgreSQL 비교 규칙으로 고정한다. `low_id < high_id` check와 두 값의 non-null/different 조건을 둔다.

동시 open은 `INSERT ... ON CONFLICT ... RETURNING` 또는 같은 효과의 transaction으로 기존 conversation을 반환한다. 후보 conversation/participant orphan row가 남지 않아야 한다.

### 5.2 Group DM

권장 생성 계약은 `CreateGroupDM(inviteeActorIds)`다. authenticated creator는 서버가 자동 포함한다.

- invitee는 중복 없는 2명 이상 9명 이하다.
- creator가 invitee 목록에 있어도 조용히 중복 제거할지 strict 거절할지 계약으로 정한다. 권장안은 strict 거절이다.
- 최종 participant는 creator 포함 3명 이상 10명 이하다.
- 모든 participant와 conversation row는 한 transaction에서 저장한다.
- 같은 participant set의 여러 Group DM은 허용한다. 1:1과 달리 participant set dedupe를 기본 정책으로 두지 않는다.
- 향후 participant 추가 command도 conversation row를 lock하고 active count가 10을 넘지 않게 해야 한다.

Group DM 최대 10명은 message send command가 아니라 생성/추가 command가 보장한다. send 시 participant count가 10을 넘는 손상 상태를 발견하면 발행하지 않고 invariant violation으로 처리한다.

## 6. stream 생성, sequence, 멱등성

- DM stream ID는 `dm:<dmConversationId>`처럼 결정적으로 만든다. 문자열 형식은 contracts provider에서 한 번만 정의한다.
- `message_streams.target_type = 'dm'`, `target_id = dmConversationId`이며 기존 unique `(target_type, target_id)`를 재사용한다.
- DMConversation 생성 시 stream을 eager 생성하거나 첫 메시지 append 때 lazy 생성할 수 있다. 현재 message-send는 lazy upsert를 지원하므로 MVP는 이를 재사용하는 것이 작다.
- 빈 DM의 sync는 DM은 존재하고 권한이 있지만 stream row가 없는 상태를 빈 결과로 처리해야 한다.
- 같은 DM의 sequence만 1, 2, 3으로 증가한다. 다른 DM/channel/thread sequence와 비교하지 않는다.
- 같은 sender actor + DM stream + `clientMessageId`는 한 메시지만 만든다.
- concurrent first message와 concurrent retry에서도 `(stream_id, sequence)`와 멱등 unique 조건을 PostgreSQL이 보장한다.
- 기존 accepted 재시도는 새 sequence와 새 outbound delivery event를 만들지 않는다.
- 멱등 키가 같지만 target/content가 다른 재요청을 기존 accepted로 볼지 conflict로 거절할지 확정한다. 권장안은 저장된 원본과 비교해 conflict를 반환하는 것이다.

DMConversation row와 stream row의 생명주기는 분리하되, stream target이 존재하지 않는 conversation을 가리키지 않도록 resolver가 fail-closed로 동작한다.

## 7. recipient 계산, 배달, 동기화

### 7.1 recipient snapshot

최초 메시지 저장 전에 확인한 active participant snapshot을 `recipientActorIds`로 사용한다.

- sender 포함을 권장한다. 송신자의 다른 탭/기기도 `chat.message.created`를 받아 동기화할 수 있다.
- 최대 10명이고 중복이 없어야 한다.
- message request에서 받은 값이 아니라 DB participant에서만 만든다.
- 동일 transaction snapshot이 필요한지 participant mutation 정책과 함께 결정한다.

현재 메시지 PR은 target resolution과 append가 하나의 DB transaction이 아니다. leave/add가 아직 비범위면 snapshot race가 없지만, participant mutation을 도입할 때 membership version 또는 하나의 transaction 경계로 재설계해야 한다.

### 7.2 실시간 배달

Flow 6의 `OutboundMessageDeliveryRequested`와 Gateway local session fan-out을 그대로 사용한다. DM 전용 broker topic과 DM 전용 socket fan-out을 만들지 않는다.

- 모든 Gateway가 이벤트를 받고 자기 local participant session만 찾는다.
- 한 participant의 여러 session에 전송한다.
- 오프라인 participant는 정상 skip이다.
- publish 실패나 socket push 실패가 저장된 DM을 rollback하지 않는다.

Flow 6이 아직 없다면 DM 이슈는 저장·accepted·이벤트 생성까지 검증하고, 실시간 E2E 완료는 Flow 6 의존성으로 명시한다.

### 7.3 누락 동기화

Flow 7 `SyncStream`이 DM stream에도 같은 `afterSequence` 페이지 계약을 제공해야 한다.

- DMConversation과 active participant를 확인한 뒤 읽는다.
- 다른 participant나 임의 actor는 읽을 수 없다.
- 결과는 sequence 오름차순이다.
- 배달 실패, 오프라인, 재접속은 저장 메시지를 sync해 복구한다.
- 탈퇴·재초대 때 어떤 sequence 범위를 볼 수 있는지는 이 계획의 미결정 항목이다.

## 8. 예상 계약

메시지 전송은 PR #28의 공통 계약을 확장 없이 우선 재사용한다.

```ts
type SendMessageRequest = {
  commandId?: string;
  clientMessageId: string;
  target: {
    type: "dm";
    dmConversationId: string;
  };
  content: { type: "text"; text: string };
  sentAtClient?: string;
};
```

DMConversation 생성 계약 후보는 다음과 같다.

```ts
type OpenDirectMessageRequest = {
  targetActorId: string;
};

type CreateGroupDMRequest = {
  inviteeActorIds: string[];
  title?: string;
};

type DMConversationDto = {
  dmConversationId: string;
  type: "ONE_TO_ONE" | "GROUP";
  streamId: string;
  participantActorIds: string[];
  createdByActorId: string;
  createdAt: string;
};
```

`title`은 제품 요구가 없다면 이번 범위에서 제외한다. actorId/creator/workspaceId를 client body에서 받지 않는다. `OpenDirectMessage`는 이미 존재하는 1:1 DM이면 같은 DTO를 반환하는 멱등 command다.

Gateway event는 공통 `chat.message.send` + DM target을 권장한다. 문서 스케치의 별도 `chat.dm.message.send`를 유지하면 parser만 DM target command로 mapping하되 서버 내부 append/ACK 계약은 복제하지 않는다. 실제 채널 메시지 Gateway PR 계약을 확인해 하나만 선택한다.

## 9. 예상 DB 스키마

```sql
CREATE TABLE dm_conversations (
  dm_conversation_id text PRIMARY KEY,
  conversation_type text NOT NULL
    CHECK (conversation_type IN ('ONE_TO_ONE', 'GROUP')),
  created_by_actor_id text NOT NULL,
  direct_actor_low_id text NULL,
  direct_actor_high_id text NULL,
  created_at timestamptz NOT NULL,
  CHECK (
    (conversation_type = 'ONE_TO_ONE'
      AND direct_actor_low_id IS NOT NULL
      AND direct_actor_high_id IS NOT NULL
      AND direct_actor_low_id < direct_actor_high_id)
    OR
    (conversation_type = 'GROUP'
      AND direct_actor_low_id IS NULL
      AND direct_actor_high_id IS NULL)
  )
);

CREATE UNIQUE INDEX dm_conversations_direct_pair_idx
  ON dm_conversations (direct_actor_low_id, direct_actor_high_id)
  WHERE conversation_type = 'ONE_TO_ONE';

CREATE TABLE dm_participants (
  dm_conversation_id text NOT NULL
    REFERENCES dm_conversations(dm_conversation_id),
  actor_id text NOT NULL,
  joined_at timestamptz NOT NULL,
  invited_by_actor_id text NULL,
  left_at timestamptz NULL,
  PRIMARY KEY (dm_conversation_id, actor_id)
);

CREATE INDEX dm_participants_actor_active_idx
  ON dm_participants (actor_id, dm_conversation_id)
  WHERE left_at IS NULL;
```

`left_at`은 미래 호환 후보일 뿐, leave/reinvite 의미를 정하기 전에는 mutation API를 노출하지 않는다. active participant 수 3~10은 여러 row에 걸친 불변식이라 단순 `CHECK`로 보장할 수 없다. Group DM 생성 transaction과 향후 participant 추가 transaction이 conversation row lock 아래 보장한다. 필요하면 DB trigger는 실제 mutation 요구가 생긴 뒤 검토한다.

기존 메시지 PR의 다음 schema를 재사용한다.

```text
message_streams(stream_id PK, target_type, target_id, last_sequence, ...)
messages(message_id PK, stream_id FK, sequence, sender_actor_id,
         target_type, target_id, client_message_id, content..., ...)
```

DB 조립 package는 `DMConversationDatabase & MessageSendDatabase & GatewayTicketDatabase`를 합성하고 각 owner의 public table contract를 통해 migration한다. DM package가 message-send 내부 SQL을 deep import하지 않는다.

## 10. 예상 패키지와 파일

실제 이름은 기준 브랜치의 패키지 경계를 우선한다.

```text
packages/realtime-chat-dm-contracts/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  src/index.ts
  test/dm-contract.test.ts

packages/realtime-chat-dm/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  owner-docs/architecture.md
  owner-docs/testing.md
  src/dm-conversation.ts
  src/dm-conversation-module.ts
  src/dm-conversation-table.ts
  src/table-contract.ts
  src/usecases/open-direct-message/open-direct-message.usecase.ts
  src/usecases/open-direct-message/open-direct-message.kysely.ts
  src/usecases/create-group-dm/create-group-dm.usecase.ts
  src/usecases/create-group-dm/create-group-dm.kysely.ts
  src/adapters/resolve-dm-message-target.ts
  test/dm-conversation-invariants.test.ts
  test/dm-message-target-resolver.test.ts

packages/realtime-chat-message-send/
  src/message-send-module.ts                     # fail-closed wiring 검토
  src/usecases/send-message/send-message.usecase.ts
  test/message-send-usecase-invariants.test.ts
  README.md
  public-docs/invariants.md                      # 생기면 갱신

packages/realtime-chat-database/
  src/realtime-chat-database.ts
  README.md

apps/realtime-chat-api/
  src/app.ts                                     # DM 생성과 내부 message route
  src/runtime/create-runtime-deps.ts
  test/dm-routes.test.ts
  public-docs/runtime-contract.md
  owner-docs/runtime-operations.md

apps/realtime-chat-gateway/
  src/app.ts                                     # DM target event relay
  src/runtime/realtime-chat-api-client.ts
  test/dm-message-relay.test.ts
  public-docs/runtime-contract.md
```

Flow 6/7 provider가 이미 생겼다면 DM package는 그 공개 계약만 소비하고 별도 delivery/sync package를 만들지 않는다.

## 11. 단계별 구현

### 단계 1. 의존 브랜치와 계약 확정

1. PR #28 메시지 send 구현을 포함한 기준에서 브랜치를 만든다.
2. Gateway/API의 실제 channel message command 계약이 있는지 확인한다.
3. 공통 `SendMessageRequest`와 `PublicMessage`를 재사용하고 DM DTO 복제를 금지한다.
4. Flow 6 delivery와 Flow 7 sync의 선행/후행 이슈 관계를 기록한다.

### 단계 2. DMConversation 계약과 DB 구현

1. `OpenDirectMessage`, `CreateGroupDM`, DTO와 오류 schema를 만든다.
2. `dm_conversations`, `dm_participants`, partial unique index migration을 추가한다.
3. canonical pair 함수와 self DM 거절을 구현한다.
4. 동시 1:1 open이 같은 conversation을 반환하도록 atomic query를 구현한다.
5. Group DM creator 포함 3~10명, 중복·존재 validation과 transaction insert를 구현한다.

### 단계 3. DM target resolver와 권한 연결

1. authenticated actor와 dmConversationId로 conversation/active participants를 조회한다.
2. nonparticipant/missing target을 fail-closed `target_not_found`로 mapping한다.
3. 결정적 DM stream ID와 중복 없는 participant snapshot을 반환한다.
4. 운영 module에서 default resolver를 쓸 수 없도록 명시적 DM resolver wiring을 요구한다.
5. participant 검사가 기존 멱등 메시지 조회보다 먼저 일어남을 테스트한다.

### 단계 4. 공통 메시지 append 재사용

1. DM target을 PR #28의 `sendMessage()`에 전달한다.
2. lazy stream creation, stream lock, sequence, message insert를 그대로 사용한다.
3. 기존 accepted 재시도에서 새 delivery가 발행되지 않음을 보장한다.
4. 동일 멱등 키의 payload mismatch 정책을 구현하거나 후속 결정을 명시한다.

### 단계 5. API와 Gateway 조립

1. 외부 DM open/group create route에 actor 인증과 body validation을 연결한다.
2. Gateway message event에서 session actor를 주입하고 DM target command를 API로 전달한다.
3. 도메인 거절과 transport/API 장애를 구분한다.
4. accepted/rejected에서 `clientMessageId` correlation을 보존한다.
5. 앱 README/public runtime contract와 owner 운영 문서를 갱신한다.

### 단계 6. 배달과 동기화 연결

1. DM resolver의 active participant snapshot을 outbound event에 넣는다.
2. Flow 6 fan-out을 통해 각 participant local session에 `chat.message.created`를 보낸다.
3. Flow 7 SyncStream read authorization에 같은 DM participant policy를 연결한다.
4. publish 실패/recipient offline 후 `afterSequence`로 복구되는지 검증한다.

### 단계 7. 문서 승격과 end-to-end 검증

1. provider README/public docs에 API와 불변조건을 승격한다.
2. SQL, canonicalization, membership snapshot 결정은 owner docs에 기록한다.
3. 1:1, Group DM, 동시성, 권한, 배달, sync 시나리오를 실제 런타임에서 검증한다.
4. 이 계획 문서는 history로 남기되 AGENTS route에 추가하지 않는다.

## 12. 테스트 계획

### 12.1 단위 테스트

- 1:1 canonical pair는 actor 순서가 바뀌어도 같다.
- self DM을 거절한다.
- Group DM은 creator 포함 3명과 10명을 허용하고 2명·11명을 거절한다.
- 중복 invitee와 blank actor ID를 거절한다.
- creator를 invitee에 포함한 입력을 정한 정책대로 처리한다.
- DM participant에게 stream ID와 전체 active participant snapshot을 반환한다.
- nonparticipant와 missing DM은 외부에서 같은 거절이 된다.
- participant 검사는 기존 멱등 메시지 조회보다 먼저 수행된다.
- default target resolver가 운영 DM wiring에 사용되지 않는다.
- sender 포함 recipient 정책과 중복 제거를 검증한다.

### 12.2 PostgreSQL 통합 테스트

- 반대 순서로 동시 `OpenDirectMessage`를 실행해 conversation 하나만 생긴다.
- concurrent open 실패 경로에 orphan conversation/participant가 없다.
- 1:1 conversation에는 정확히 두 participant row가 생긴다.
- Group DM conversation과 모든 participant는 함께 commit되거나 함께 rollback된다.
- partial unique index는 Group DM participant set 중복까지 막지 않는다.
- 동일 DM의 동시 메시지 두 개가 서로 다른 연속 sequence를 받는다.
- 다른 DM의 sequence는 독립적으로 증가한다.
- 같은 sender/stream/clientMessageId 동시 요청은 메시지 하나만 만들고 같은 accepted를 반환한다.
- 기존 accepted 재시도는 delivery event를 다시 발행하지 않는다.
- `(stream_id, sequence)`와 active participant index의 query plan을 확인한다.

### 12.3 API/Gateway 통합 테스트

- 인증 actor가 1:1 DM을 열고 같은 target 재호출에서 같은 ID를 받는다.
- Group DM 생성 body의 creator/workspace 위조 필드를 strict schema로 거절한다.
- Gateway가 client actorId를 신뢰하지 않고 session actor로 DM message를 보낸다.
- nonparticipant 메시지는 DB write와 outbound publish 없이 거절된다.
- participant 메시지는 accepted되고 recipientActorIds가 DB participant와 일치한다.
- API timeout/5xx는 domain rejection이 아니라 재시도 가능한 Gateway 오류다.
- DM publish 실패에도 저장과 accepted는 유지된다.

### 12.4 End-to-end 테스트

- 서로 다른 Gateway에 연결된 두 actor가 1:1 DM을 열고 메시지를 실시간으로 주고받는다.
- 송신자의 다른 탭과 수신자의 여러 탭이 정책대로 같은 message를 한 번씩 병합한다.
- 10명 Group DM의 모든 online participant가 message를 받고 nonparticipant는 받지 않는다.
- offline participant가 재접속 후 `afterSequence`로 누락 DM을 복구한다.
- ACK 유실 뒤 같은 `clientMessageId` 재전송이 UI에 중복 메시지를 만들지 않는다.
- 한 DM에 동시 전송한 메시지가 모든 client에서 같은 stream sequence 순서로 보인다.

Flow 6/7이 별도 이슈라면 해당 E2E는 dependency 완료 뒤 실행하는 acceptance suite로 남긴다. 인메모리 DB mock만으로 sequence·unique·transaction 완료를 주장하지 않는다.

## 13. 관측성

구조화 로그와 metric에는 다음 correlation을 사용한다.

```text
requestId, commandId, clientMessageId, dmConversationId,
streamId, messageId, sequence, conversationType,
participantCount, result, rejectionReason, durationMs
```

message content와 전체 participant actor ID 목록은 로그에 남기지 않는다.

관측할 항목은 다음과 같다.

- direct open created/existing/failed 수
- group create 성공과 participant count 분포
- DM target missing/nonparticipant 거절 수
- DM message accepted/idempotent replay/rejected 수
- recipient count와 outbound publish 실패 수
- DM sync 복구 message 수와 권한 거절 수
- DB unique conflict와 transaction retry 수

## 14. 완료 조건

- DMConversation/participant가 별도 provider로 구현되고 message-send 내부에 DM 정책이 흩어지지 않는다.
- 1:1 DM은 actor 순서와 동시 요청에 관계없이 같은 pair당 하나만 존재한다.
- self DM을 거절하고 1:1은 정확히 2명이다.
- Group DM은 creator 포함 서로 다른 3~10명만 생성할 수 있다.
- DM participant만 읽고 쓸 수 있으며 missing/nonparticipant 정보 노출 정책이 일관된다.
- 운영 wiring은 default message target resolver가 아니라 fail-closed DM resolver를 사용한다.
- DM이 channel과 같은 stream lock, sequence, message 저장, 멱등성 pipeline을 재사용한다.
- 같은 sender + DM stream + clientMessageId 재시도는 기존 accepted를 반환하고 재발행하지 않는다.
- recipient는 DB active participants에서 계산되고 client 입력을 신뢰하지 않는다.
- 저장 성공과 delivery 성공이 분리되며 offline/누락은 Flow 7 sync로 복구할 수 있다.
- 단위·PostgreSQL·API/Gateway 통합·E2E 테스트가 의존 Flow 범위에 맞게 통과한다.
- 관련 package와 app build/typecheck, schema migration이 통과한다.
- public 계약은 README/public docs에, 내부 SQL·경계 결정은 owner docs에 반영된다.
- 이 `notes/implementation-plans` 경로는 AGENTS context route에 포함되지 않는다.

## 15. 비범위

- 메시지 append, sequence, `clientMessageId` 공통 알고리즘 재작성
- Flow 6 broker/Gateway fan-out 자체 구현
- Flow 7 SyncStream 자체 구현
- DM 목록/검색/last message projection과 unread/read cursor
- Group DM 이름·이미지·관리자·소유권
- participant 초대·강퇴·탈퇴·재초대 command
- message edit/delete/reaction/attachment
- user block, abuse report, account deletion 정책
- typing indicator, presence, push notification
- Group DM participant set 중복 방지
- workspace별 DM namespace

## 16. 탈퇴·재초대·workspace 독립성 미결정

### 16.1 탈퇴

현재 스케치는 `LeaveDMConversation`을 후보로 두지만 다음이 확정되지 않았다.

- 1:1 DM에서 한 명이 탈퇴할 수 있는가, 아니면 숨김/보관만 가능한가
- Group DM이 2명 이하가 되면 conversation을 유지하는가
- 마지막 participant 또는 creator가 나가면 누가 관리하는가
- 탈퇴 시 과거 메시지 read 권한을 즉시 잃는가
- 탈퇴 직전 resolve된 recipient snapshot에 메시지를 배달해도 되는가
- 탈퇴가 message send와 경쟁할 때 어떤 transaction 순서를 적용하는가

이번 이슈에서는 leave API를 노출하지 않는다. `left_at`을 schema에 둘 경우에도 의미를 공개 계약으로 약속하지 않는다.

### 16.2 재초대

재초대 시 다음 중 하나를 결정해야 한다.

1. 기존 participant row의 `left_at`을 비우고 과거 전체 history를 다시 허용한다.
2. membership epoch/history row를 새로 만들고 재초대 이후 sequence만 허용한다.
3. 새 DMConversation을 생성한다.

이 결정은 `SyncStream`의 최소 readable sequence, read cursor, unique participant key에 영향을 준다. 결정 전에는 재초대 command를 구현하지 않는다.

### 16.3 workspace 독립성

이벤트 스토밍 스케치는 DM을 workspace와 독립된 전역 actor 대화로 정의한다. 이 정의를 따르면 다음 의미가 된다.

- `dm_conversations`와 DM command에 `workspaceId`가 없다.
- 같은 두 actor의 1:1 DM은 workspace마다 따로 생기지 않고 전역으로 하나다.
- 두 actor가 같은 workspace를 공유하는지 여부는 기본 생성 조건이 아니다.
- workspace 탈퇴가 DM membership을 자동 종료하지 않는다.

그러나 실제 인증 actor가 전역 사용자 ID인지 workspace별 persona인지, 아무 관계없는 actor에게 DM을 열 수 있는지, 조직 정책이 DM을 제한하는지는 아직 확정되지 않았다. 구현 시작 전에 identity/relationship policy를 확인한다. workspace scope가 필요하다고 바뀌면 1:1 unique key도 `(workspace_id, actor_low_id, actor_high_id)`로 달라지므로 migration 전에 결정해야 한다.

## 17. 위험과 추가 미결정

| 항목 | 위험 | 이슈 시작 시 결정/완화 |
| --- | --- | --- |
| default resolver | 임의 DM 저장과 빈 recipient 발행 가능 | 운영 module에서 DM provider를 필수 주입하고 fail-closed test |
| 멱등 조회 순서 | 탈퇴 actor가 기존 accepted를 조회할 수 있음 | participant 확인을 target resolution에서 먼저 수행 |
| participant mutation race | 저장 시점과 recipient snapshot이 달라질 수 있음 | leave/add 비범위, 도입 시 membership version/transaction 설계 |
| 1:1 canonicalization | app/DB 정렬 차이로 duplicate pair 가능 | canonical 규칙 하나와 DB partial unique constraint |
| Group DM count | 여러 row 불변식을 CHECK만으로 보장 불가 | 생성 transaction, 향후 add는 conversation row lock |
| ID probe | nonparticipant가 DM 존재를 추론 | missing/nonparticipant 외부 오류 통합 |
| sender recipient | ACK와 created가 같은 탭에서 중복처럼 보임 | sender 포함 정책과 client messageId/sequence 병합 확정 |
| payload mismatch replay | 같은 멱등 키로 다른 content를 보내도 기존 accepted 가능 | 원본 비교 후 conflict 권장 |
| 빈 DM stream | lazy stream row가 없어 sync가 target missing으로 오인 | DM 존재/권한과 message stream 존재를 분리해 빈 결과 반환 |
| participant 계정 상태 | 삭제·정지 actor를 생성/배달 대상에 포함할 수 있음 | ActorDirectory/identity policy port 확정 |
| contract naming | 스케치의 `chat.dm.message.send`와 PR의 공통 target이 중복 | 실제 Gateway contract에 하나만 채택 |
| Flow 6/7 선행성 | 저장만 되고 실시간 배달·복구 E2E 불가 | 이슈 dependency와 단계별 완료 범위를 명시 |

## 18. 문서 경계 결과

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 계획 기록이다.
- 현재 소비자가 읽는 공개 파일은 기존 앱/package의 README와 public docs이며 Flow 12 계약은 아직 없다.
- 구현 시 소비자는 DM/message/delivery/sync provider의 `README.md`와 `public-docs/*`만 읽는다.
- 소비자에서 deny할 경로는 provider의 `AGENTS.md`, `owner-docs/`, `notes/`다.
- owner는 provider `AGENTS.md`가 안내하는 `owner-docs/*`를 읽는다.
- 확정된 DM contract와 invariant만 README/public docs로 승격하고 탐색·미결정은 notes에 남긴다.
- 이 계획을 포함한 `notes/`는 agent route에 넣지 않는다.
- parent directory deny 뒤 child public docs를 다시 여는 permission 패턴은 사용하지 않는다.
