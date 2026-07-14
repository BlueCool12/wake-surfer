# Flow 6 실시간 배달 fan-out 구현 계획

> 상태: 이 문서는 이슈와 작업 브랜치를 만들기 위한 구현 계획이다. 현재 구현 계약이나 확정된 공개 API가 아니다.
> 구현 중 확정된 계약은 해당 provider의 `README.md`, `public-docs/`, `owner-docs/`로 승격하고 이 문서를 agent context route에 포함하지 않는다.

## 1. 목적과 범위

저장된 채널 메시지에 대한 `OutboundMessageDeliveryRequested`를 모든 Gateway 프로세스가 받고, 각 프로세스가 자신이 소유한 로컬 WebSocket 세션 중 수신자 세션에만 `chat.message.created`를 전송한다.

이 계획이 다루는 흐름은 다음과 같다.

```text
채널 메시지 저장 및 commit
→ API가 수신자를 확정해 배달 이벤트 발행
→ 브로커가 모든 Gateway 프로세스에 같은 이벤트 전파
→ 각 Gateway가 로컬 수신자 세션 조회
→ 열린 소켓에 chat.message.created 전송 또는 로컬 세션 없음으로 skip
```

이 흐름의 성공은 실시간 push의 최선 노력 성공을 뜻한다. 메시지 저장 성공과 동일한 트랜잭션 결과가 아니며, 일부 또는 전체 push 실패가 이미 저장된 메시지를 rollback하지 않는다.

## 2. 구현 시작 전 선행 확인

채널 메시지 전송 구현은 다른 브랜치의 PR에 있으므로, 이 이슈를 시작하기 전에 그 PR이 제공하는 발행 지점을 먼저 확인한다. 현재 작업트리에는 메시지 저장 패키지, 채널 수신자 계산, `OutboundMessageDeliveryRequested` 계약이 없다.

확인하고 문서화할 항목은 다음과 같다.

- 메시지 저장 commit 이후 `OutboundMessageDeliveryRequested`를 호출하는 port 또는 hook의 이름과 위치
- 이벤트가 저장 트랜잭션 안에서 만들어지는지, commit 이후 발행되는지, outbox를 사용하는지
- `eventId`, `eventType`, 계약 버전, `occurredAt`의 생성 주체
- `message`의 확정 필드: `messageId`, `streamId`, `sequence`, `senderId`, `content`, `serverCreatedAt` 및 클라이언트가 중복 병합에 필요한 값
- 수신자 필드가 `recipientUserIds`인지, 현재 스케치의 `recipients: { type: "USERS", userIds }`인지
- 새 저장이 없는 멱등 재시도에서 배달 이벤트를 다시 발행하는지
- 송신자를 수신자 집합에 포함해 다른 탭도 동기화하는지
- 발행 실패가 API 응답과 로그에 어떤 의미를 가지는지
- 브라우저용 `chat.message.created` 계약과 `OutboundMessageDeliveryRequested` 내부 계약을 같은 package가 소유하는지 분리하는지

이 확인 전에는 유사 DTO를 새로 복제하지 않는다. PR의 계약이 확정되면 Flow 6은 그 공개 export에 의존하고 deep import하지 않는다.

## 3. 현재 상태

현재 작업트리에서 구현된 관련 기반은 다음과 같다.

- `apps/realtime-chat-api`는 Gateway ticket 발급·소비와 PostgreSQL 조립만 제공한다.
- `apps/realtime-chat-gateway`는 ticket 인증, WebSocket 연결, heartbeat, 종료를 제공한다.
- Gateway의 세션은 `apps/realtime-chat-gateway/src/app.ts` 안의 `Map<WebSocket, GatewaySession>`에만 있다.
- `GatewaySession`에는 `actorId`, `sessionId`, `gatewayId`, `connectedAt`가 있지만 actor별 조회 색인이 없다.
- WebSocket message envelope, `chat.message.created`, outbound subscriber, 브로커 설정은 아직 공개 계약이 아니다.
- `packages/realtime-chat-gateway`, `packages/realtime-chat-outbound-delivery`, 공통 realtime-chat contracts package는 현재 작업트리에 없다.

따라서 현재 구조에서는 세션 수는 셀 수 있지만 `recipientUserIds`로 한 사용자의 모든 로컬 탭을 효율적으로 찾을 수 없다. 또한 API와 Gateway는 별도 실행 프로세스이므로 한 프로세스의 인메모리 이벤트 버스를 공유할 수 없다.

## 4. 책임 경계

### 4.1 API

- 저장과 권한 검사를 마친 기준 상태에서 수신자 집합을 계산한다.
- private channel membership과 송신자 포함 정책을 적용한다.
- 메시지 commit 이후 `OutboundMessageDeliveryRequested`를 발행한다.
- Gateway가 다시 권한이나 membership을 계산하지 않아도 되는 완결된 payload를 만든다.
- 발행 실패를 기록하되 이미 commit된 메시지를 rollback하지 않는다.
- 장기적으로 확실한 발행이 필요하면 outbox를 별도 이슈로 도입한다.

API는 WebSocket, Gateway 인스턴스 위치, 소켓 식별자를 알지 않는다.

### 4.2 브로커

- API publisher와 Gateway subscriber 사이의 프로세스 경계를 잇는다.
- 하나의 이벤트를 경쟁 소비시키지 않고 **모든 Gateway 프로세스**에 전달한다.
- 이벤트 payload를 임의로 보강하거나 도메인 수신자를 다시 계산하지 않는다.
- 연결 시작·재연결·구독 해지 생명주기와 오류를 런타임에 노출한다.

Gateway별 consumer group으로 한 이벤트를 한 Gateway에만 배분하는 방식은 이 요구에 맞지 않는다. 각 Gateway 프로세스 또는 각 세션 레지스트리를 가진 worker가 독립 구독자여야 한다.

### 4.3 Gateway

- 구독 시 내부 이벤트 schema와 지원 버전을 검증한다.
- `recipientUserIds`로 현재 프로세스의 로컬 세션만 조회한다.
- 하나의 actor에 여러 탭·기기가 연결되어 있으면 모든 로컬 세션에 전송한다.
- 이벤트 message를 공개 WebSocket 계약인 `chat.message.created` envelope로 변환한다.
- 닫힌 소켓, 느린 consumer, 직렬화·전송 실패를 개별 세션 단위로 격리한다.
- 로컬 세션이 없으면 정상 skip으로 처리하며 다른 Gateway를 조회하거나 API에 재질의하지 않는다.
- 전송 실패 때문에 브로커 이벤트 전체를 재처리하지 않는다.

Gateway는 channel membership을 계산하거나 메시지 저장 여부를 판단하지 않는다.

### 4.4 로컬 세션 레지스트리

현재 소켓 키 `Map`을 다음 두 조회 방향을 만족하는 작은 provider로 추출한다.

```text
actorId → 해당 actor의 모든 local session
socket/sessionId → close 시 제거할 session
```

최소 연산 후보는 다음과 같다.

```ts
register(session): void
removeBySocket(socket): void
findByActorIds(actorIds): readonly LocalGatewaySession[]
count(): number
```

동일 actor와 동일 socket의 중복 등록, close와 delivery의 경합, 이미 닫힌 socket을 반환하지 않는 규칙을 테스트로 고정한다. 변경 가능한 `Map`과 실제 socket은 앱 밖으로 그대로 노출하지 않고 조회·전송 port로 감싼다.

## 5. 브로커 1차 어댑터와 다중 프로세스 한계

최초 스케치의 인메모리/mock 어댑터는 contract test와 단일 프로세스 개발 harness에는 유용하다. 다음 항목을 빠르게 검증할 수 있다.

- publisher/subscriber port 형태
- 두 독립 subscriber가 같은 이벤트를 받는 broadcast 의미
- 구독 해지와 종료
- Gateway 배달 유스케이스의 성공·skip·오류 격리

그러나 API와 Gateway를 별도 Node.js 프로세스로 실행하면 각 프로세스의 heap이 분리되므로 인메모리 어댑터로는 이벤트가 전달되지 않는다. Gateway 프로세스가 여러 개면 이 한계는 더 명확하다. 따라서 인메모리 어댑터만 구현한 상태를 Flow 6 완료로 보지 않는다.

다중 프로세스 MVP 어댑터 후보는 Redis Pub/Sub다. 모든 Gateway가 같은 channel을 독립 구독하면 broadcast 요구에 맞고 구현이 작다. 다만 Redis Pub/Sub는 구독이 끊긴 동안의 메시지를 보존하지 않으므로 누락은 Flow 7의 `afterSequence` 동기화로 복구해야 한다. Redis Streams나 durable broker를 선택한다면 consumer group의 경쟁 소비가 아니라 Gateway 인스턴스별 broadcast/구독 topology가 필요하다.

이 이슈 시작 시 다음 중 하나를 명시적으로 선택한다.

1. Redis Pub/Sub까지 포함해 별도 API·Gateway 프로세스 fan-out을 완료한다.
2. core와 인메모리 어댑터만 먼저 구현하고, 결과를 “단일 프로세스 검증 단계”로 제한한 뒤 외부 브로커 이슈를 별도로 만든다.

권장안은 1번이다. 사용자가 이 계획을 기준으로 하나의 Flow 6 이슈를 만들 경우, 다중 프로세스 acceptance test까지 있어야 문서의 “모든 Gateway” 조건을 충족한다.

## 6. `recipientUserIds` 계약

API가 만든 수신자 집합은 권한 판단이 끝난 권위 있는 배달 대상이다. Gateway는 이를 필터링하거나 확장하지 않는다.

계약에서 확정할 불변조건은 다음과 같다.

- 사용자 ID는 인증된 actor/session의 `actorId`와 같은 식별자 namespace를 쓴다.
- 빈 문자열과 허용 상한을 넘는 배열은 schema 단계에서 거절한다.
- 중복 ID는 publisher에서 제거하고 Gateway도 방어적으로 한 번만 조회한다.
- 순서는 의미가 없다.
- 송신자 포함 여부는 API 정책으로 한 번만 결정한다. 포함하면 송신자의 다른 탭도 `created`를 받는다.
- `recipientUserIds`는 클라이언트로 내보내지 않는다. `chat.message.created`에는 message만 포함한다.
- 이벤트를 받는 모든 Gateway가 메시지 본문과 수신자 ID를 보므로 broker channel은 내부망, 인증, 최소 ACL을 전제로 한다.
- 배열 크기와 이벤트 전체 byte 상한을 둔다. 큰 채널에서 사용자 ID 전체 fan-out이 한계를 넘는 시점은 별도 라우팅 전략 이슈로 전환한다.

중복 배달 가능성은 `messageId`와 `streamId + sequence`로 클라이언트가 병합할 수 있어야 한다. broker가 적어도 한 번 전달을 제공할 경우 Gateway 메모리의 전역 dedupe만으로 정확히 한 번을 약속하지 않는다.

## 7. 예상 패키지와 파일

실제 이름은 채널 메시지 PR이 만든 package 경계를 우선한다. 아래는 현재 구조를 기준으로 한 후보다.

```text
packages/realtime-chat-contracts/                  # PR에 동등 package가 없을 때만
  README.md
  public-docs/api.md
  public-docs/invariants.md
  src/outbound-message-delivery-requested.ts
  src/chat-message-created.ts
  test/outbound-message-delivery-requested.test.ts

packages/realtime-chat-outbound-delivery/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  owner-docs/architecture.md
  owner-docs/testing.md
  src/outbound-delivery-ports.ts
  src/deliver-outbound-message.usecase.ts
  src/in-memory-outbound-event-bus.ts
  src/index.ts
  test/deliver-outbound-message.test.ts
  test/in-memory-outbound-event-bus.test.ts

packages/realtime-chat-gateway/                    # 세션 provider가 PR에도 없을 때
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  owner-docs/architecture.md
  src/local-session-registry.ts
  src/index.ts
  test/local-session-registry.test.ts

apps/realtime-chat-api/
  src/runtime/create-runtime-deps.ts               # publisher adapter 조립
  src/config/env.ts                                # 외부 broker 선택 시 설정
  test/app-smoke.test.ts 또는 delivery wiring test
  README.md
  public-docs/runtime-contract.md
  owner-docs/runtime-operations.md

apps/realtime-chat-gateway/
  src/app.ts                                       # register/remove와 socket sender 조립
  src/runtime/create-runtime-deps.ts               # subscriber 시작/종료 조립
  src/config/env.ts
  test/app-smoke.test.ts
  test/outbound-delivery.test.ts
  README.md
  public-docs/runtime-contract.md
  owner-docs/runtime-operations.md
```

Redis를 선택하면 transport 구현은 `packages/realtime-chat-outbound-delivery` 내부 infrastructure slice 또는 변경 이유가 독립적일 때 별도 broker package에 둔다. root `shared`, 범용 repository, API 앱과 Gateway 앱에 복제된 Redis client를 만들지 않는다. 배포 wiring이 필요하면 root `docker-compose.yml`과 해당 module 소유 Docker 문서는 별도 Docker 계약 검토를 거친다.

## 8. 단계별 구현

### 단계 1. 선행 PR 계약 합치기

1. 채널 메시지 PR을 기준 브랜치에 반영하거나 작업 브랜치가 그 commit을 포함하게 한다.
2. 위 선행 확인 목록을 실제 export와 테스트로 확인한다.
3. 이벤트/클라이언트 schema의 소유 package를 정하고 중복 타입을 제거한다.
4. sender 포함, 멱등 재시도 재발행, publish 실패 의미를 이슈 acceptance에 기록한다.

### 단계 2. 내부 이벤트와 WebSocket 출력 계약 고정

1. `OutboundMessageDeliveryRequested` runtime schema와 TypeScript type을 공개 export한다.
2. `chat.message.created` envelope schema와 protocol version을 고정한다.
3. ID, recipient 수, content, event byte 상한을 검증한다.
4. 계약 provider의 README/public docs와 contract test를 작성한다.

### 단계 3. 로컬 세션 레지스트리 추출

1. 현 `Map<WebSocket, GatewaySession>`을 actor별 색인과 역색인을 가진 provider로 옮긴다.
2. ticket 소비 성공 후 register, close/error 후 remove를 연결한다.
3. 동일 actor 다중 소켓 조회와 경합 규칙을 단위 테스트한다.
4. Gateway 앱은 count와 생명주기만 조립하도록 유지한다.

### 단계 4. 배달 유스케이스 구현

1. 입력 schema 검증 뒤 recipient ID를 정규화한다.
2. local registry에서 대상 세션을 찾는다.
3. `chat.message.created`를 이벤트당 한 번 직렬화한다.
4. `readyState === OPEN`과 `bufferedAmount` 상한을 확인한 후 각 socket에 전송한다.
5. 세션 하나의 오류가 다른 세션 전송을 중단하지 않게 결과를 집계한다.
6. `deliveredSessionCount`, `skippedSessionCount`, `failedSessionCount`를 로그·metric 입력으로 반환한다.

### 단계 5. 브로커 port와 인메모리 어댑터 구현

1. API가 쓰는 `publish(event)`와 Gateway가 쓰는 `subscribe(handler): unsubscribe` port를 분리한다.
2. 인메모리 어댑터가 같은 이벤트를 등록된 모든 subscriber에 전달하도록 한다.
3. handler 오류 격리, unsubscribe, 중복 subscribe, shutdown을 테스트한다.
4. 이 단계가 프로세스 간 통신을 제공하지 않음을 이름과 문서에 명시한다.

### 단계 6. 다중 프로세스 어댑터와 런타임 조립

1. 선택한 외부 broker client를 API와 Gateway 런타임에서 조립한다.
2. API publisher는 채널 메시지 저장 PR이 제공하는 port에 연결한다.
3. 각 Gateway 프로세스가 독립 subscriber로 등록하고 배달 유스케이스를 호출한다.
4. subscriber 준비 후 WebSocket 수락을 시작하고, 종료 시 새 배달 수신을 멈춘 뒤 구독과 client를 닫는다.
5. broker 단절 시 재연결 정책과 readiness 정책을 적용한다. liveness는 프로세스 생존과 분리한다.
6. 환경 변수와 운영 계약을 앱 public docs에 반영한다.

### 단계 7. 통합 검증과 문서 승격

1. API 1개, Gateway 2개, 서로 다른 Gateway에 연결된 두 client로 fan-out을 검증한다.
2. offline recipient, 다중 탭, 느린 client, subscriber 재연결을 검증한다.
3. 구현에서 확정한 public contract와 owner 결정을 각 provider 문서로 승격한다.
4. 이 계획 문서는 history로 남기되 AGENTS route에 추가하지 않는다.

## 9. 테스트 계획

### 계약 테스트

- 유효한 이벤트와 `chat.message.created`를 parse/serialize한다.
- 필수 message 필드, 잘못된 ID, 중복·과다 recipient, 지원하지 않는 version을 거절한다.
- 내부 `recipientUserIds`가 클라이언트 출력에 노출되지 않는다.

### 단위 테스트

- 동일 actor의 두 세션을 모두 찾는다.
- 여러 actor 중 로컬에 있는 세션만 찾는다.
- close 이후 세션이 조회되지 않는다.
- recipient ID 중복이 중복 socket 전송을 만들지 않는다.
- 로컬 세션이 없으면 오류가 아니라 skip 결과다.
- 한 socket 전송 실패 후에도 나머지 socket에는 전송한다.
- 닫힌 socket과 `bufferedAmount` 상한을 넘은 socket을 건너뛰거나 정책대로 종료한다.
- 이벤트 하나를 socket 수만큼 다시 JSON 직렬화하지 않는다.

### 어댑터 계약 테스트

- publisher 한 번에 독립 subscriber 두 개가 모두 이벤트를 받는다.
- consumer group식 단일 소비가 아님을 고정한다.
- unsubscribe한 Gateway에는 이후 이벤트가 전달되지 않는다.
- 잘못된 payload는 로그·metric 후 폐기되고 프로세스를 종료하지 않는다.
- broker 연결 끊김과 재연결 후 구독을 복구한다.

### 앱 통합 테스트

- 서로 다른 Gateway에 연결된 두 사용자에게 각 로컬 socket을 통해 같은 저장 메시지가 전달된다.
- 한 Gateway에 대상 세션이 없더라도 다른 Gateway의 전달은 성공한다.
- 송신자 포함 정책에 따라 송신자의 다른 탭 동기화가 일관된다.
- API publish 실패에도 저장 성공/accepted 결과가 뒤집히지 않는다.
- Gateway 종료 시 subscriber와 broker client가 누수 없이 닫힌다.

외부 broker 통합 테스트는 실제 프로세스 경계를 포함해야 한다. 하나의 테스트 프로세스에서 인메모리 객체를 공유하는 테스트만으로 다중 Gateway 완료를 주장하지 않는다.

## 10. 관측성

구조화 로그에는 최소한 다음 correlation 필드를 사용한다.

```text
eventId, eventType, messageId, streamId, sequence,
gatewayId, recipientCount, matchedSessionCount,
deliveredSessionCount, skippedSessionCount, failedSessionCount,
reason, durationMs
```

메시지 content, 전체 recipient 목록, 인증 정보는 로그에 남기지 않는다.

metric 후보는 다음과 같다.

- outbound event publish 성공/실패 수
- Gateway event 수신·계약 거절 수
- 로컬 세션 match·skip 수
- socket 전송 성공·실패·느린 consumer skip 수
- broker 연결 상태와 재연결 수
- 이벤트 수신부터 socket send까지의 지연
- 현재 actor별/전체 로컬 세션 수

`RECIPIENT_LOCAL_SESSION_NOT_FOUND`는 정상적인 offline/타 Gateway 상태이므로 error 로그를 남발하지 않는다. 집계 metric 또는 debug 수준으로 관찰한다. 반면 계약 불일치, subscriber 중단, 지속적인 publish 실패는 경고 또는 오류로 구분한다.

## 11. 완료 조건

- 채널 메시지 PR의 실제 `OutboundMessageDeliveryRequested` 계약을 재사용하며 DTO 복제가 없다.
- API만 권한과 recipient를 계산하고 Gateway는 로컬 세션 조회만 한다.
- 동일 이벤트를 모든 Gateway 프로세스가 받는 broadcast topology가 테스트로 증명된다.
- 서로 다른 두 Gateway에 연결된 대상들이 각각 `chat.message.created`를 받는다.
- 한 actor의 모든 로컬 탭이 정책대로 배달받는다.
- 대상 로컬 세션 없음과 개별 socket 실패가 전체 이벤트 처리 실패를 만들지 않는다.
- 메시지 저장 성공과 실시간 배달 성공이 분리되어 있고 publish 실패가 저장을 rollback하지 않는다.
- backpressure 상한과 느린 consumer 처리 정책이 구현·문서화되어 있다.
- publisher/subscriber의 시작, readiness, 재연결, 종료가 누수 없이 동작한다.
- 계약·단위·외부 broker 통합 테스트와 관련 package/app build, typecheck가 통과한다.
- 소비자 공개 계약은 README/public docs에, 내부 구현 결정은 owner docs에 반영된다.
- `notes/implementation-plans`는 AGENTS context route에 포함되지 않는다.

## 12. 비범위

- 채널 메시지 저장, sequence 발급, `clientMessageId` 멱등성 자체의 재구현
- Flow 7 `afterSequence` 조회 API와 클라이언트 동기화 구현
- read cursor, presence, DM, thread, system message
- 정확히 한 번 socket 전달 보장
- offline push notification 또는 장기 배달 큐
- Gateway 간 socket migration과 전역 session registry
- 대규모 채널용 room/topic 기반 동적 구독 최적화
- durable outbox와 broker 재발행 worker. 단, 필요성 및 후속 이슈는 기록한다.

## 13. 위험과 미결정

| 항목 | 위험 | 이슈 시작 시 결정/완화 |
| --- | --- | --- |
| 선행 PR 계약 | 계획과 실제 필드·package가 달라질 수 있음 | PR merge commit 기준으로 schema와 발행 port를 먼저 확인 |
| sender 포함 | ACK와 `created`가 같은 탭에서 중복처럼 보일 수 있음 | 다른 탭 동기화 요구와 클라이언트 병합 규칙을 함께 확정 |
| 발행 원자성 | DB commit 뒤 프로세스 종료 시 event 유실 가능 | MVP best effort를 명시하고 Flow 7 복구, 필요 시 outbox 후속 이슈 |
| 인메모리 bus | 별도 프로세스에서 전혀 전달되지 않음 | 개발/test 전용으로 제한하고 외부 broker acceptance 요구 |
| broker 전달 의미 | 중복·순서 역전·단절 중 유실 가능 | `messageId`, stream sequence 기반 병합과 sync를 전제 |
| broadcast topology | consumer group을 쓰면 한 Gateway만 수신 | Gateway/worker별 독립 subscription 테스트 |
| 큰 recipient 배열 | 이벤트 크기, 모든 Gateway의 O(R) 조회 비용 증가 | recipient·byte 상한, 규모 초과 시 room routing 별도 설계 |
| 개인정보 노출 | 모든 Gateway가 content와 recipient ID를 수신 | 내부 broker 인증·ACL·암호화, payload/log 최소화 |
| backpressure | 느린 socket이 메모리와 event loop를 압박 | `bufferedAmount` 상한, 전송 skip/close 정책, metric |
| readiness | broker 장애 시 연결은 되지만 실시간 배달이 안 될 수 있음 | subscriber 미준비를 readiness에 반영할지 운영 정책 확정 |
| protocol version | rolling deploy 중 구·신 Gateway 계약 불일치 | 명시적 version과 호환 기간 또는 additive 변경 원칙 |
| actor 식별자 | ticket의 `actorId`와 recipient ID가 다르면 무배달 | 같은 namespace 불변조건과 통합 테스트 |
| 세션 경합 | event 조회 직후 socket close 가능 | send 직전 상태 확인과 개별 실패 격리 |

## 14. 문서 경계 결과

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 계획 기록이다.
- 현재 소비자가 읽는 공개 파일은 기존 `apps/realtime-chat-api/public-docs/runtime-contract.md`와 `apps/realtime-chat-gateway/public-docs/runtime-contract.md`이며, Flow 6 계약은 아직 없다.
- 구현 시 새 provider 소비자는 해당 provider의 `README.md`와 `public-docs/*`만 읽게 한다.
- 소비자에서 deny할 경로는 provider의 `AGENTS.md`, `owner-docs/`, `notes/`다.
- owner는 해당 provider의 `AGENTS.md`가 안내하는 `owner-docs/*`를 읽는다.
- 이 계획을 포함한 `notes/`는 agent route에 넣지 않는다.
- parent directory deny 뒤 child public docs를 다시 여는 permission 패턴은 사용하지 않는다.
