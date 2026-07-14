# Flow 05 — ACK 유실 후 멱등 재시도 구현 계획

> **주의:** 이 문서는 현재 구현 계약이 아니라 GitHub 이슈 작성과 작업 브랜치 분리를 위한 사람용 구현 계획이다. 확정된 외부 계약은 각 패키지의 `README.md`와 `public-docs/`에 별도로 반영해야 하며, 이 문서를 에이전트 기본 문맥이나 소비자 계약으로 사용하지 않는다.

## 1. 목적과 범위

서버가 메시지를 저장했지만 `chat.message.accepted`가 유실된 경우, 클라이언트가 같은 논리 메시지를 재전송해도 다음 결과를 보장한다.

- 새 메시지를 저장하지 않는다.
- 새 stream `sequence`를 발급하지 않는다.
- 최초 저장된 `messageId`, `streamId`, `sequence`, `createdAt`을 다시 반환한다.
- 중복 요청 때문에 outbound delivery를 다시 발행하지 않는다.
- 클라이언트는 낙관적 메시지 한 건을 서버 확정 메시지 한 건으로 수렴시킨다.

이 Flow는 채널 메시지 전송 본체를 다시 구현하지 않는다. 메시지 전송 패키지의 멱등성 불변조건, API/Gateway 전달 계약, 클라이언트의 ACK 시간 초과 및 재시도 동작을 연결하고 실제 PostgreSQL 경쟁 조건으로 검증하는 작업이다.

## 2. 현재 상태

현재 작업트리에는 메시지 전송 백엔드 패키지가 아직 없고 Gateway는 티켓 인증과 로컬 세션 등록까지만 수행한다. 웹 앱에는 다음 임시 구현이 있다.

- `apps/web/src/features/chat/useChatRoom.ts`는 최초 전송에 `clientMessageId`를 생성한다.
- 사용자가 재시도하면 같은 `clientMessageId`를 재사용한다.
- `accepted`는 `clientMessageId`로 낙관적 메시지를 찾아 서버의 `messageId`와 `sequence`로 치환한다.
- `created`는 `messageId` 중복을 제거한다.
- 목 전송기는 명시적 `rejected`만 흉내 내며, ACK 유실과 시간 초과 상태는 표현하지 않는다.

로컬 `feat/26-message-send` 브랜치에는 다음 핵심 기반이 있다. 이 브랜치는 채널 메시지 전송 본체의 선행 의존성으로 보고 이 계획에서 코드를 복제하지 않는다.

- `messages`의 `UNIQUE (sender_actor_id, stream_id, client_message_id)`
- stream row lock 안에서 기존 메시지를 재조회한 뒤 sequence를 한 번만 증가시키는 `appendMessage`
- 기존 메시지 발견 시 최초 `PublicMessage`를 그대로 반환하는 `sendMessage`
- 경쟁 중 기존 메시지를 발견한 경우 delivery를 다시 발행하지 않는 분기
- `clientMessageId`를 항상 포함하는 accepted/rejected 응답

다만 현재 테스트는 저장 함수를 대역으로 바꾼 use case 단위 테스트 중심이므로, 실제 PostgreSQL의 유일 제약·row lock·두 동시 트랜잭션 동작은 별도 검증이 필요하다. 또한 메시지 전송 브랜치에는 API/Gateway/WebSocket 연결과 실제 ACK 시간 초과 처리가 포함되어 있지 않다.

## 3. 선행 의존성: 채널 메시지 전송 PR에서 확인할 항목

이 Flow 이슈를 시작하기 전에 메시지 전송 PR의 최종 머지 결과에서 아래 항목을 확인한다.

1. `clientMessageId`가 요청의 필수 필드이며 비어 있지 않고 길이가 제한돼 있는가.
2. 멱등성 범위가 `(senderActorId, streamId, clientMessageId)`로 DB 유일 제약에 반영됐는가.
3. target 해석과 현재 쓰기 권한 검사가 분리돼 있는가. 기존 메시지의 ACK 복구는 현재 쓰기 권한이 사라져도 최초 accepted 결과를 반환할 수 있어야 한다.
4. 최초 조회와 insert 사이의 경쟁이 DB 트랜잭션 안에서 다시 확인되는가.
5. 경쟁 요청 두 개가 서로 다른 `messageId`를 생성하더라도 승자 한 건만 저장되고 패자는 저장된 승자의 결과를 반환하는가.
6. `appendMessage`의 `existing` 결과와 빠른 기존 조회 결과 모두 delivery publish를 건너뛰는가.
7. delivery publish 실패가 accepted 결과를 실패로 바꾸지 않는가.
8. accepted 응답이 최초 저장된 전체 메시지 또는 최소한 `clientMessageId`, `messageId`, `streamId`, `sequence`, `createdAt`을 안정적으로 반환하는가.
9. `commandId`의 의미가 확정됐는가. 권장 규칙은 논리 메시지 식별자인 `clientMessageId`는 재시도 동안 유지하고, 전송 시도 추적용 `commandId`는 시도마다 새로 발급하는 것이다.
10. target resolver가 삭제·보관된 target에서도 이미 저장된 메시지의 stream을 안정적으로 식별할 수 있는가. target 미존재와 현재 쓰기 불가를 하나의 결과로 합치면 ACK 복구가 막힐 수 있다.

위 조건 중 1~8이 만족되지 않으면 이 Flow 브랜치에서 우회 구현하지 않고 메시지 전송 PR 또는 후속 선행 이슈에서 먼저 보완한다.

## 4. 책임 경계

### 메시지 전송 패키지

- 멱등성 키와 트랜잭션 불변조건을 소유한다.
- 기존 결과와 최초 생성 결과를 구분하되 외부에는 둘 다 accepted로 반환한다.
- 최초 생성에 대해서만 outbound delivery를 요청한다.
- 재시도가 권한 검사를 우회해 새 작업을 수행하지 않도록, 기존 메시지 반환 이외의 상태 변경을 금지한다.

### API 앱과 내부 HTTP 계약

- 인증된 Gateway의 요청에서 `actorId`를 신뢰 경계로 주입한다.
- `actorId`를 클라이언트 요청 본문에서 받지 않는다.
- 패키지의 accepted/rejected 결과를 의미 변경 없이 반환한다.
- API 시간 초과나 5xx를 도메인 rejected로 바꾸지 않는다. 이는 결과 불명 상태이므로 Gateway와 클라이언트가 같은 `clientMessageId`로 재시도할 수 있어야 한다.

### Gateway 패키지와 앱

- JSON, 크기, event type, 필수 식별자만 검증한다.
- `clientMessageId`를 새로 만들거나 재작성하지 않는다.
- API accepted/rejected를 해당 소켓에 전달한다.
- 내부 API 호출 시간 초과는 영구 실패가 아니라 재시도 가능한 전송 실패로 분류한다.
- Gateway 자체가 메시지 멱등성 상태를 메모리에 저장하지 않는다.

### 웹 클라이언트

- 새 논리 메시지를 만들 때 한 번만 `clientMessageId`를 생성한다.
- ACK 대기 시간 초과, 연결 단절, 서버 결과 불명 상태에서 같은 `clientMessageId`와 같은 payload로 재시도한다.
- 늦게 도착한 최초 ACK와 재시도 ACK가 모두 도착해도 한 메시지만 확정한다.
- `created`가 ACK보다 먼저 오거나 나중에 와도 `messageId`와 `clientMessageId` 매핑으로 한 항목에 수렴한다.

## 5. 멱등성 키와 트랜잭션

### 키

```text
(senderActorId, streamId, clientMessageId)
```

- `senderActorId`는 인증 문맥에서 가져온다.
- `streamId`는 target resolver가 반환한 서버 소유 식별자다.
- `clientMessageId`는 클라이언트가 논리 메시지마다 생성하고 재시도 동안 유지한다.
- 별도 idempotency table 없이 `messages` 행과 유일 인덱스를 멱등성 레코드로 사용해도 충분하다. 시스템 메시지처럼 별도 source event 멱등성이 필요한 Flow와는 합치지 않는다.

### 트랜잭션 권장 순서

1. target을 안정적인 `streamId`로 해석한다.
2. 트랜잭션 밖의 빠른 조회로 기존 accepted 메시지가 있으면 즉시 반환한다.
3. 최초 요청 후보일 때 쓰기 권한을 확인한다.
4. 트랜잭션을 시작하고 stream 행을 생성 또는 조회한 뒤 `FOR UPDATE`로 잠근다.
5. 잠금 획득 후 같은 멱등성 키를 다시 조회한다.
6. 존재하면 기존 메시지를 반환하고 commit한다.
7. 존재하지 않으면 `last_sequence`를 한 번 증가시키고 메시지 한 건을 insert한 뒤 commit한다.
8. commit 결과가 `created`일 때만 delivery publish를 시도한다.

유일 인덱스는 최종 안전망이어야 한다. 구현이 stream lock에 의존하더라도 유일 제약을 제거하지 않는다. 향후 잠금 범위가 바뀌거나 다른 저장 경로가 생겨도 중복 저장을 DB가 막아야 한다.

## 6. 동일 키에 다른 payload가 들어온 경우

MVP 권장 정책은 **최초 저장 결과 우선**이다. 동일 멱등성 키가 이미 존재하면 이후 payload로 기존 메시지를 수정하지 않고 최초 accepted 결과를 반환한다. ACK 복구 경로에서 payload 비교 실패 때문에 결과를 잃지 않는 장점이 있다.

다만 이는 클라이언트가 `clientMessageId`를 잘못 재사용했을 때 변경된 내용을 조용히 무시할 수 있다. 따라서 다음을 계약에 명시하고 관측 로그 또는 지표를 추가한다.

- `clientMessageId`는 하나의 논리 메시지에만 사용한다.
- 재시도 payload는 최초 시도와 같아야 한다.
- 서버는 동일 키의 후속 payload로 기존 메시지를 갱신하지 않는다.

payload 충돌을 명시적으로 `idempotency_conflict`로 거절할지는 이슈 착수 시 결정할 수 있다. 이를 선택하면 최초 요청의 정규화된 target/content fingerprint 저장과 공개 rejected reason 추가가 필요하므로 별도 계약 변화로 다룬다.

## 7. 중복 요청의 delivery 정책

중복 요청에서는 delivery event를 다시 발행하지 않는다.

- 최초 저장과 publish가 성공하고 ACK만 유실된 경우, 재발행은 수신자에게 중복 push를 만들 수 있다.
- 최초 저장은 성공했지만 publish가 실패한 경우에도 재시도 요청을 delivery 복구 수단으로 사용하지 않는다.
- publish 실패 복구는 Flow 07의 `afterSequence` 동기화가 담당한다.
- 향후 전달 보장을 강화할 때는 message transaction과 outbox record를 함께 저장하는 별도 설계를 검토한다.

즉 message insert의 `created`/`existing` 판정이 delivery publish 여부를 결정하는 단일 기준이다.

## 8. 예상 패키지와 파일

메시지 전송 PR 머지 후 실제 이름을 다시 확인하되, 현재 브랜치 기준 예상 변경 지점은 다음과 같다.

### 백엔드 불변조건 보강

- `packages/realtime-chat-message-send/src/usecases/send-message/send-message.kysely.ts`
- `packages/realtime-chat-message-send/src/usecases/send-message/send-message.usecase.ts`
- `packages/realtime-chat-message-send/src/message-send-table.ts`
- `packages/realtime-chat-message-send/test/message-send-usecase-invariants.test.ts`
- `packages/realtime-chat-message-send/test/message-send-postgres.integration.test.ts` 신규
- `packages/realtime-chat-message-send/README.md`

### 공개 및 서버 간 계약

- `packages/realtime-chat-message-send-contracts/src/index.ts`
- `packages/realtime-chat-message-send-contracts/test/message-send-request-body.test.ts`
- `packages/realtime-chat-message-send-contracts/README.md`
- 메시지 전송 PR 또는 후속 런타임 연결 이슈가 추가하는 API/Gateway 내부 HTTP 계약과 WebSocket event schema

### 앱 연결

- `apps/realtime-chat-api/src/app.ts`
- `apps/realtime-chat-api/src/runtime/create-runtime-deps.ts`
- `apps/realtime-chat-gateway/src/app.ts` 또는 메시지 수신 handler slice
- `apps/realtime-chat-gateway/src/runtime/realtime-chat-api-client.ts`
- 각 앱의 smoke/API client 테스트

### 클라이언트

- `apps/web/src/features/chat/contracts.ts` 삭제 후 계약 패키지 import로 전환
- `apps/web/src/features/chat/transport/chatTransport.ts`
- 실제 WebSocket 전송 구현 파일 신규
- `apps/web/src/features/chat/useChatRoom.ts`
- `useChatRoom` 또는 transport의 재시도·ACK 순서 테스트 신규

앱 파일에 멱등성 판단을 중복 구현하지 않는다. 앱은 패키지를 조립하고 통신 결과를 relay하는 얇은 경계로 유지한다.

## 9. 계약 변화

필수 계약은 다음과 같다.

- send 요청의 `clientMessageId`는 필수다.
- accepted 응답의 `clientMessageId`도 필수다.
- 동일 `(senderActorId, streamId, clientMessageId)`는 항상 최초 저장 메시지와 같은 결과를 반환한다.
- `chat.message.accepted`는 저장 확정 ACK이며 delivery ACK가 아니다.
- API/Gateway 통신 실패는 `chat.message.rejected`의 도메인 거절과 구분한다.
- `commandId`를 사용한다면 전송 시도 상관관계, `clientMessageId`는 논리 메시지 상관관계로 정의한다.

클라이언트 상태에는 ACK 결과 불명을 표현할 수단이 필요하다. 기존 `pending | sent | failed`를 유지한다면 ACK 제한시간 초과를 `failed`의 재시도 가능 원인으로 모델링하고, 영구 도메인 거절과 구분할 `failureKind` 또는 reason을 둔다. 더 명확한 모델을 원하면 `pending | retryable | sent | rejected`로 확장한다.

## 10. 단계별 구현

1. 메시지 전송 PR 머지 커밋을 기준으로 3절의 선행 조건을 확인하고 부족한 항목을 선행 수정으로 분리한다.
2. 계약 패키지에서 `clientMessageId`, accepted 의미, `commandId` 규칙, 통신 실패와 도메인 거절의 차이를 문서화하고 schema 경계값을 테스트한다.
3. 실제 PostgreSQL을 사용하는 통합 테스트 장치를 마련하고 멱등성 경쟁 조건을 재현한다.
4. API 내부 전송 endpoint와 Gateway API client가 `clientMessageId`를 그대로 전달하고 accepted 결과를 손실 없이 relay하는지 테스트한다.
5. Gateway의 WebSocket handler에 결과 불명 오류를 별도 event 또는 연결 상태로 노출한다. 영구 rejected로 위장하지 않는다.
6. 실제 웹 transport에 ACK 대기 타이머와 요청 시도 추적을 추가한다. 타이머는 연결 종료 및 ACK 수신 시 정리해 누수를 막는다.
7. 재시도 시 새로운 `clientMessageId`를 만들지 않고, 권장 정책에 따라 새 `commandId`만 생성한다.
8. `useChatRoom`에서 늦은 ACK, 중복 ACK, `created` 선도착을 모두 idempotent하게 병합한다.
9. 패키지, API, Gateway, 웹의 관련 테스트를 실행하고 문서의 완료 조건을 확인한다.
10. 현재 계약으로 확정된 내용만 해당 provider의 `README.md`/`public-docs`/`owner-docs`에 승격한다. 이 계획 문서는 `notes`에 유지한다.

## 11. 경쟁 조건 및 실패 순서 테스트

### PostgreSQL 통합 테스트

- 같은 actor/stream/clientMessageId로 동시에 2개 요청: 메시지 1건, sequence 증가 1회, 두 결과의 메시지 동일.
- 같은 clientMessageId지만 다른 actor: 각각 저장 가능.
- 같은 actor/clientMessageId지만 다른 stream: 각각 저장 가능.
- 빠른 기존 조회 직후 경쟁 insert 발생: 유일 제약 오류가 외부 500으로 새지 않고 기존 accepted로 수렴.
- 첫 요청 commit 후 ACK 유실, 두 번째 요청: 기존 결과 반환, delivery publish 추가 0회.
- 최초 delivery publish 실패 후 재시도: accepted 반환, delivery 재발행 0회.
- 서로 다른 clientMessageId의 동시 요청: 메시지 2건, 중복 없는 연속 sequence.

### use case 단위 테스트

- 기존 메시지 fast path는 권한 검사, ID 생성, append, delivery publish를 호출하지 않는다.
- transaction 경쟁의 `existing` 결과도 delivery publish를 호출하지 않는다.
- 최초 `created`만 publish를 한 번 호출한다.
- publish 실패와 무관하게 accepted를 반환한다.
- 기존 결과는 최초 `createdAt`, content, messageId, sequence를 보존한다.

### Gateway/API 계약 테스트

- 요청의 `clientMessageId`가 API까지 동일하게 전달된다.
- accepted의 `clientMessageId`와 최초 메시지 정보가 소켓 event에 보존된다.
- API timeout/5xx/응답 파싱 실패가 영구 도메인 rejected로 변환되지 않는다.
- 늦은 첫 응답과 재시도 응답이 모두 도착해도 Gateway가 새 메시지를 만들거나 식별자를 바꾸지 않는다.

### 클라이언트 테스트

- ACK 제한시간 초과 후 재시도 payload의 `clientMessageId`가 최초와 같다.
- 재시도 ACK로 pending 항목이 기존 서버 메시지로 치환된다.
- 최초 ACK가 늦게 도착한 뒤 재시도 ACK가 와도 메시지 한 건이다.
- `created`가 accepted보다 먼저 도착해도 메시지 한 건이다.
- accepted가 created보다 먼저 도착해도 메시지 한 건이다.
- 다른 clientMessageId를 가진 동일 text는 서로 다른 메시지로 남는다.
- 컴포넌트 해제·연결 종료 시 ACK 타이머와 listener가 정리된다.

## 12. 완료 조건

- 실제 PostgreSQL에서 동시 중복 요청이 메시지 한 건과 sequence 한 번만 만든다.
- 모든 중복 경로가 최초 `messageId`, `streamId`, `sequence`, `createdAt`을 반환한다.
- 중복 요청은 delivery event를 다시 발행하지 않는다.
- API/Gateway는 `clientMessageId`를 변경하지 않는다.
- 클라이언트는 ACK 유실 후 같은 `clientMessageId`로 재시도할 수 있다.
- 늦거나 중복된 accepted/created event 순서와 무관하게 UI 메시지가 한 건으로 수렴한다.
- 통신 실패와 도메인 거절이 클라이언트 상태에서 구분된다.
- 관련 패키지의 현재 공개 계약 문서가 갱신되고 `notes` 문서는 계약 route에 포함되지 않는다.

## 13. 비범위

- 채널 메시지 전송 본체 재구현
- DM 및 thread 전송의 제품 정책 확정
- 수신자 fan-out 구현
- publish 실패 복구와 `afterSequence` 동기화 구현
- read cursor와 unread projection
- 재접속 후 여러 stream의 동기화
- 브라우저 새로고침을 넘어 pending 메시지를 영구 저장하는 기능
- exactly-once socket delivery 보장
- outbox pattern 도입
- 메시지 편집·삭제

## 14. 위험과 미결정

### 결정이 필요한 항목

- 동일 키의 다른 payload를 최초 결과로 수렴시킬지 `idempotency_conflict`로 거절할지.
- ACK 대기 제한시간과 자동 재시도 횟수. 기본 권장은 사용자 명시 재시도 또는 짧은 제한 횟수이며 무한 자동 재시도는 금지한다.
- `commandId`를 필수로 할지와 재시도마다 새로 발급할지. 권장은 시도마다 새 값이다.
- 클라이언트 상태명을 `failed`와 reason으로 유지할지 `retryable`/`rejected`로 분리할지.

### 주요 위험

- target resolver가 권한·활성 상태 판단까지 합치면 과거 accepted 메시지를 재조회하지 못할 수 있다.
- 실제 DB 테스트 없이 대역 테스트만 통과하면 트랜잭션 격리와 잠금 순서 문제가 운영에서 드러날 수 있다.
- ACK 시간 초과를 도메인 거절로 표시하면 사용자가 새 `clientMessageId`로 다시 보내 중복 메시지를 만들 수 있다.
- 중복 요청에서 delivery를 재발행하면 송신자 다중 탭과 수신자 UI에 중복 push가 생길 수 있다.
- `clientMessageId` 길이 제한이 없으면 인덱스 크기와 입력 남용 문제가 생긴다.
- 메모리 타이머와 listener 정리가 누락되면 채널 이동과 재연결 때 중복 콜백이 누적된다.

## 15. 문서 경계 반영

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`에 두는 사람용 배경 계획이다.
- 소비자가 읽을 현재 계약은 메시지 전송 계약 패키지와 런타임 provider의 `README.md`/`public-docs`에 둔다.
- 내부 트랜잭션·잠금·테스트 전략은 메시지 전송 provider의 `owner-docs`에 둔다.
- provider의 `notes`와 이 전역 `notes` 경로는 consumer agent route에서 제외한다.
- parent deny 아래 public path를 다시 여는 권한 구조는 사용하지 않는다.
