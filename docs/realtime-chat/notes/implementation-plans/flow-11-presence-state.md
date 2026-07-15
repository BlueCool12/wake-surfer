# Flow 11 Presence 상태 변경 구현 계획

> **문서 상태: 이슈 작성용 구현 계획이며 현재 계약이 아니다.**
>
> 이 문서는 `flow-sequence-guide.md`의 Flow 11과 이벤트 스토밍 스케치를 현재 저장소 구조에서 구현하기
> 위한 사람용 `notes`다. 에이전트 기본 문맥이나 소비자 계약 경로에 포함하지 않는다. 실제 구현에서
> 확정된 계약은 각 provider의 `README.md`와 `public-docs/`에, 내부 상태 전환과 장애 복구 규칙은
> `owner-docs/`에 별도로 승격한다.

## 1. 목적과 범위

사용자의 WebSocket session 생명주기와 활동 신호를 바탕으로 서버군 전체에서 일관된 Presence 상태를
계산하고, 같은 workspace의 허용된 사용자에게만 상태 변경을 전달한다.

이 계획의 핵심 범위는 다음과 같다.

- 인증이 완료된 Gateway session 등록과 종료를 Presence 입력으로 전달
- 여러 탭, 여러 기기, 여러 Gateway에 걸친 active session 집계
- `ONLINE`, `OFFLINE`, `AWAY`, `BUSY`의 effective 상태 계산
- 수동 `BUSY`와 자동 idle `AWAY`의 우선순위
- Gateway 비정상 종료와 누락된 close event를 lease 만료로 복구
- 상태 저장소의 원자적 첫 session/마지막 session 판정
- Presence 상태 변경 이벤트 발행과 workspace 단위 수신자 계산
- Gateway fan-out과 client event 계약
- 상태 조회, 전환, 배달에 필요한 테스트와 관측성

Presence는 결과적 정합성이 허용되는 사용자 경험 상태다. 다만 “마지막 session이 아닌데 OFFLINE으로
보내지 않는다”는 판정은 공유 상태 저장소에서 원자적으로 보장해야 한다.

## 2. 현재 상태

### Gateway 구현

현재 `apps/realtime-chat-gateway/src/app.ts`는 다음 로컬 상태를 closure로 소유한다.

```txt
Map<WebSocket, GatewaySession>
Set<WebSocket> pendingAuthentications
Set<WebSocket> awaitingPong
```

`GatewaySession`에는 `actorId`, `connectedAt`, `gatewayId`, `sessionId`가 있고, ticket 소비 성공 뒤
`sessions` Map에 등록된다. `close`에서는 Map에서 삭제하며, ping/pong에 응답하지 않은 socket은 다음
heartbeat 주기에 `terminate()`한다. graceful shutdown은 모든 socket에 close를 보낸 뒤 유예 시간 후
강제 종료한다.

현재 구현에는 다음이 없다.

- session 등록·종료를 외부 Presence에 알리는 포트
- user별 로컬 session index와 로컬 active session count
- 서버군 전체 session 저장소
- session lease 갱신과 stale session 정리
- Presence 상태 모델과 수동 상태
- 사용자 활동 event
- Presence event bus, workspace audience resolver, socket fan-out
- Presence snapshot/query

### API와 package

- `apps/realtime-chat-api`는 gateway ticket runtime만 조립한다.
- Presence 전용 package, contracts, API endpoint, Redis client가 없다.
- `packages/realtime-chat-database`는 PostgreSQL gateway ticket table만 조립한다.
- root `docker-compose.yml`에는 persistence를 끈 `realtime-chat-redis` service가 이미 정의돼 있지만 현재
  TypeScript package는 Redis를 사용하지 않는다.
- 현재 인증 경계는 `actorId`를 제공하며 persistent `userId`와의 관계는 확정되지 않았다.
- workspace membership과 recipient 계산을 제공하는 package도 현재 저장소에 없다.

### 문서 스케치와의 차이

초기 Flow 11은 `GatewaySessionRegistry`가 `activeSessionCount = 1/0`을 반환하고 그 값으로 ONLINE/OFFLINE을
결정하는 것처럼 보인다. 이 설명은 단일 Gateway 프로세스에서는 가능하지만 서버군 전체에서는 충분하지
않다. 구현 계획에서는 로컬 registry와 전역 Presence session registry를 분리한다.

## 3. Chat과 Presence 책임 경계

Presence는 realtime-chat UI에서 소비할 수 있지만 Chat Domain의 메시지 규칙이 아니다.

| 책임 | 소유자 |
| --- | --- |
| 메시지 권한, 저장, sequence, 멱등성 | Chat/message packages |
| WebSocket과 현재 프로세스의 socket/session | Gateway package |
| 서버군 전체 session lease와 effective Presence | Presence package/service |
| actor를 canonical user로 해석 | Identity provider/API 신뢰 경계 |
| workspace membership과 수신자 계산 | Workspace/Permission provider |
| 상태 변경을 Gateway 서버군에 전달 | Presence outbound delivery adapter |
| 로컬 recipient socket 조회와 push | Gateway outbound adapter |

Chat은 Presence table이나 Redis key를 직접 읽지 않는다. Chat UI나 web client는 Presence의 공개 snapshot과
`presence.userStatusChanged` 계약만 소비한다. Presence event를 chat message로 저장하거나 stream
sequence를 발급하지 않는다. 반대로 Presence가 channel message, read cursor, DM participant 모델을
소유하지 않는다.

message outbound delivery와 Presence delivery가 같은 Redis 또는 broker infrastructure를 공유할 수는
있다. 그래도 event contract, audience 정책, 재처리 의미는 별도 package가 소유한다.

## 4. 로컬 Map과 서버군 전체 active session 문제

현재 `Map<WebSocket, GatewaySession>`은 로컬 socket 생명주기의 source of truth로는 적절하다. 하지만
다음 상황에서 전역 첫/마지막 session을 판단할 수 없다.

```txt
Gateway A: user-1의 탭 1 연결
Gateway B: user-1의 탭 2 연결
```

Gateway A의 Map에서 탭 1이 사라지면 로컬 count는 0이지만 Gateway B에는 session이 남아 있다. A가
OFFLINE을 발행하면 잘못된 상태다. 반대로 A가 user-1의 첫 local session을 등록해도 B에 이미 session이
있다면 서버군 전체 첫 session이 아니다.

따라서 다음을 불변조건으로 둔다.

- 로컬 Map은 socket lookup과 로컬 정리에만 사용한다.
- 로컬 active session count는 metric 또는 local optimization일 뿐 Presence 전환 근거가 아니다.
- 서버군 전체 첫 session과 마지막 session은 공유 Presence state store의 원자적 명령 결과로만 판정한다.
- Gateway가 직접 `UserStatusChanged(ONLINE|OFFLINE)`을 만들지 않는다.
- Gateway는 idempotent한 `RegisterSession`, `RenewSessionLease`, `CloseSession`, `RecordActivity` 입력만
  보낸다.

같은 프로세스에서 user별 index가 필요하면 `Map<userId, Set<sessionId>>`를 추가할 수 있지만, 이름과
문서에서 반드시 `LocalGatewaySessionRegistry`임을 드러낸다.

## 5. identity와 session 식별 경계

Gateway ticket에서 얻는 `actorId`를 Presence의 persistent `userId`와 암묵적으로 같다고 가정하지 않는다.
API/Presence adapter는 identity provider를 통해 canonical user를 해석하거나, `actorId == userId`라는
인증 계약이 확정된 경우에만 명시적으로 변환한다. client payload에서 actor/user ID를 받지 않는다.

session 식별자는 최소 다음 범위를 구분한다.

```txt
gatewayId
  배정된 Gateway 논리 ID

gatewayInstanceId
  같은 gatewayId로 실행될 수 있는 개별 프로세스 시작 인스턴스 ID

sessionId
  인증이 완료된 WebSocket 연결 하나의 전역 고유 ID
```

`gatewayInstanceId`는 프로세스 시작 시 새로 생성한다. 같은 gatewayId의 재시작 전후 session을 혼동하지
않는다. `RegisterSession`은 `sessionId`에 대해 멱등이고, 다른 user나 gateway instance가 같은 sessionId를
재사용하려 하면 계약 위반으로 거절한다.

## 6. 상태 모델과 우선순위

Presence는 연결 상태, 활동 상태, 수동 상태를 한 enum에 덮어쓰지 않고 입력 상태를 분리한 뒤 effective
status를 계산한다.

```ts
type PresenceInputs = {
  activeSessionCount: number;
  latestActivityAt?: string;
  manualStatus?: "BUSY";
};

type EffectivePresenceStatus = "ONLINE" | "OFFLINE" | "AWAY" | "BUSY";
```

MVP 계산 순서는 다음으로 권고한다.

```txt
activeSessionCount == 0
  -> OFFLINE

activeSessionCount > 0 AND manualStatus == BUSY
  -> BUSY

activeSessionCount > 0 AND 모든 활성 session이 idle threshold를 넘김
  -> AWAY

activeSessionCount > 0 AND 최근 활동 session이 하나 이상 있음
  -> ONLINE
```

즉 단순 숫자 우선순위가 아니라 다음 제약을 갖는다.

1. `OFFLINE`은 연결이 하나도 없을 때의 강제 상태이며 manual BUSY보다 우선한다.
2. 연결이 있으면 수동 `BUSY`가 자동 `AWAY`보다 우선한다.
3. BUSY가 아니면 활성 session들의 최근 활동으로 `ONLINE` 또는 `AWAY`를 계산한다.
4. 여러 탭 중 하나라도 최근 활동 중이면 사용자는 ONLINE이다.

`AWAY`를 사용자가 수동 설정할지, `ONLINE` 수동 고정을 허용할지는 MVP 비범위로 둔다. BUSY preference를
연결 종료 뒤에도 보존할지 결정해야 한다. 권고안은 manual BUSY를 effective status와 별도 저장하고,
OFFLINE 동안에는 노출하지 않되 재접속 시 만료되지 않았다면 BUSY로 복원하는 것이다.

상태가 실질적으로 바뀔 때만 `UserPresenceChanged`를 발행한다. 단순 lease renew나 동일 status 재계산은
event를 만들지 않는다. user별 단조 증가 `revision`을 포함해 지연·중복 event가 client 상태를 되돌리지
못하게 한다.

## 7. 상태 저장소 설계

### 권고: Redis 기반 lease store

Presence session은 고빈도, 일시적 상태이며 Gateway crash 뒤 자동 만료가 필요하다. 현재 compose에도
Redis가 있으므로 MVP 기본 adapter로 Redis lease store를 권고한다. package는 Redis에 고정하지 않고
`PresenceStateStore` 포트를 노출한다.

필요한 원자적 연산은 다음과 같다.

```ts
type PresenceStateStore = {
  registerSession(input): Promise<PresenceTransitionResult>;
  renewSessionLease(input): Promise<PresenceTransitionResult>;
  closeSession(input): Promise<PresenceTransitionResult>;
  recordActivity(input): Promise<PresenceTransitionResult>;
  setManualStatus(input): Promise<PresenceTransitionResult>;
  reapExpiredSessions(input): Promise<PresenceTransitionResult[]>;
  getPresence(input): Promise<PresenceView>;
};
```

각 write는 Lua script 또는 Redis transaction으로 다음을 한 번에 처리한다.

- 중복/소유권 검증
- 만료 session 정리
- session 추가, 갱신 또는 제거
- user의 전역 active session count 계산
- effective status와 revision 갱신
- 상태가 달라졌는지 판정
- event stream/outbox를 사용한다면 transition event 기록

### key shape 후보

실제 key 이름은 adapter owner docs에서 확정한다.

```txt
presence:session:<sessionId>
  userId, gatewayInstanceId, connectedAt, lastActivityAt, leaseExpiresAt

presence:user:<userId>:sessions
  sessionId -> leaseExpiresAt의 sorted set

presence:user:<userId>:state
  effectiveStatus, manualStatus, latestActivityAt, revision, changedAt

presence:session-expiries
  전역 lease 만료 sorted set

presence:transitions
  선택: Redis Stream 기반 상태 변경 event
```

session TTL만 설정하고 user별 set에서 자동 제거되기를 기대하면 안 된다. Redis key TTL 만료는 별도 set
member를 지우지 않는다. 전역 expiry index와 reaper, 또는 동등한 정리 구조가 필요하다.

### Redis restart

현재 compose Redis는 RDB/AOF persistence가 꺼져 있다. 재시작하면 session과 상태가 사라지는 것을
허용하는 ephemeral Presence로 취급한다. 기존 WebSocket은 다음 lease renew에서 session을 재등록할 수
있어야 하며, Gateway는 renew 응답의 `registrationMissing`을 보고 idempotent register를 수행하거나 renew
자체가 재등록 의미를 가져야 한다.

초기 snapshot 조회는 상태가 없으면 OFFLINE으로 본다. Redis 재시작 직후 잠깐 OFFLINE으로 보일 수 있는
결과적 정합성을 허용할지 acceptance criteria에 명시한다. 허용하지 않는다면 persistence나 Gateway 전체
session 재등록 protocol이 필요하다.

## 8. Gateway crash와 stale session 처리

정상 close event만으로 OFFLINE을 보장할 수 없다. 프로세스 강제 종료, 노드 장애, 네트워크 단절에서는
`close` callback과 `GatewaySessionClosed`가 발생하지 않을 수 있다.

### lease와 heartbeat

- 인증 완료 뒤 session lease를 등록한다.
- Gateway는 WebSocket ping/pong 건강 상태와 별개로 Presence lease를 주기적으로 갱신한다.
- lease TTL은 renew 주기보다 충분히 길게 둔다. 예: renew 30초, TTL 90초.
- heartbeat에 응답하지 않은 socket을 terminate하면 로컬 close 경로에서 idempotent close를 요청한다.
- lease 갱신 실패가 이어져 TTL을 넘으면 reaper가 stale session을 제거한다.

socket ping/pong은 client 연결 건강을 판단하고, Presence lease는 Gateway 프로세스가 공유 저장소에 살아
있음을 증명한다. 둘의 성공을 같은 것으로 간주하지 않는다.

### reaper

하나 이상의 worker가 전역 expiry index를 주기적으로 청소한다. 여러 worker가 동시에 실행돼도 Lua 또는
claim protocol로 같은 session을 한 번만 제거한다. stale session 제거 뒤 user의 active count가 0이 된
경우에만 OFFLINE transition을 만든다.

즉시 OFFLINE은 reconnect flap을 늘릴 수 있다. lease TTL 자체가 crash 감지 지연이므로 별도 offline grace를
추가할지 결정한다. TTL과 grace를 모두 쓸 경우 최대 OFFLINE 지연을 운영 계약에 명시한다.

### graceful shutdown

Gateway가 draining을 시작하면 새 session을 받지 않는다. 보유 session close와 Presence close 요청을
best-effort로 수행하되 shutdown을 무기한 막지 않는다. close 요청이 실패해도 lease expiry가 최종 정리를
보장한다. 같은 session에 socket close, shutdown, reaper가 중복 호출돼도 결과는 멱등이어야 한다.

### network partition

Gateway가 client와는 연결돼 있지만 Presence store에 lease를 갱신하지 못하면 만료 뒤 OFFLINE으로 보일 수
있다. 이 경우 채팅 연결을 강제로 끊을지 Presence만 degraded로 둘지는 운영 결정이다. 기본 권고는 Chat
기능의 정확성과 Presence 가용성을 분리하고, Gateway readiness/metric으로 장애를 노출하면서 Presence는
stale lease를 유지하지 않는 fail-closed 만료를 따른다.

## 9. activity와 AWAY 처리

모든 마우스 이동을 Gateway로 보내면 트래픽과 Redis write가 과도하다. client는 의미 있는 activity를
throttle해 전송하고 Gateway도 session별 최소 기록 간격을 적용한다.

activity 후보:

- 명시적 `presence.activity` heartbeat
- 메시지 전송, read cursor 전진 등 서버가 확인한 사용자 행동
- browser visibility/focus 변화

단순 WebSocket ping/pong은 network 생존 신호이지 사용자가 화면을 보고 있다는 증거가 아니므로
`lastActivityAt` 갱신 근거로 쓰지 않는다.

여러 session 중 가장 최근 `lastActivityAt`이 idle threshold 안이면 ONLINE이다. idle scheduler는 모든
user를 매번 scan하지 않고 activity/idle deadline sorted set을 사용할 수 있다. deadline 처리도 현재
revision과 최신 activity를 다시 확인한 뒤 AWAY transition을 만들어, 늦게 실행된 timer가 최근 활동을
덮어쓰지 않게 한다.

BUSY 사용자는 idle deadline이 지나도 effective status가 BUSY다. BUSY를 해제하면 최근 활동 시각에 따라
즉시 ONLINE 또는 AWAY로 재계산한다.

## 10. 상태 이벤트와 공개 계약 후보

최종 이름은 contracts package가 소유한다. 아래는 이슈 작성용 후보이며 현재 계약이 아니다.

### Gateway -> Presence 내부 command

```json
{
  "eventId": "evt-session-001",
  "eventType": "GatewaySessionRegistered",
  "occurredAt": "2026-07-12T10:00:00.000Z",
  "session": {
    "sessionId": "gateway-session-001",
    "gatewayId": "gateway-1",
    "gatewayInstanceId": "gateway-instance-abc"
  }
}
```

user identity는 client body가 아니라 인증된 Gateway/API 문맥으로 전달한다. close와 renew도 같은
`sessionId + gatewayInstanceId` 소유권을 확인한다.

### Presence domain event

```json
{
  "eventId": "evt-presence-001",
  "eventType": "UserPresenceChanged",
  "occurredAt": "2026-07-12T10:00:00.100Z",
  "presence": {
    "userId": "user-1",
    "previousStatus": "OFFLINE",
    "currentStatus": "ONLINE",
    "reason": "FIRST_ACTIVE_SESSION",
    "revision": 12
  }
}
```

reason 후보:

- `FIRST_ACTIVE_SESSION`
- `LAST_ACTIVE_SESSION_CLOSED`
- `SESSION_LEASE_EXPIRED`
- `RECENT_ACTIVITY`
- `IDLE_TIMEOUT`
- `MANUAL_BUSY_SET`
- `MANUAL_BUSY_CLEARED`

public event에는 session ID, active session count, IP, device 정보, last activity 원문을 노출하지 않는다.

### Gateway -> Client

```json
{
  "type": "presence.userStatusChanged",
  "workspaceId": "workspace-1",
  "userId": "user-1",
  "status": "ONLINE",
  "changedAt": "2026-07-12T10:00:00.100Z",
  "revision": 12
}
```

client는 user별 revision보다 오래된 event를 무시한다. reconnect 시 event history에 의존하지 않고
workspace-scoped snapshot으로 현재 상태를 다시 맞춘다.

### snapshot query

실시간 event만으로 초기 상태와 유실 복구를 할 수 없다. Presence provider는 인증된 사용자가 볼 수 있는
workspace 범위에 한해 현재 member 상태 snapshot을 제공해야 한다. query는 Workspace provider가 반환한
visible member IDs만 조회하며 임의 user ID 목록으로 전역 Presence를 탐색하게 하지 않는다.

## 11. event transport와 복구 의미

Presence state가 source of truth이고 broadcast는 결과적 정합성이다. transport 선택지는 다음과 같다.

- Redis Pub/Sub: 단순하지만 subscriber 중단 중 event 유실. reconnect/snapshot 복구가 필수.
- Redis Streams: consumer group, 재처리, lag 관측이 가능하지만 운영 복잡도가 증가.
- 기존 outbound event bus: infrastructure는 공유할 수 있으나 Presence contract와 topic은 분리.

MVP에서 Pub/Sub를 선택할 수 있지만 client와 Gateway가 snapshot으로 복구할 수 있어야 한다. Streams를
선택하면 user revision/eventId로 중복을 제거한다. 상태 변경 기록과 event enqueue 사이 유실을 줄이려면
Redis Lua에서 state revision 변경과 stream `XADD`를 함께 수행하거나 durable outbox를 사용한다.

동일 status 재계산, lease renew, 중복 close는 broadcast하지 않는다. event 순서가 뒤집혀도 revision으로
최신 상태를 선택한다.

## 12. workspace 수신자 계산과 fan-out

Presence는 모든 접속자에게 전역 broadcast하지 않는다. 상태가 바뀐 사용자의 workspace membership을
Workspace/Permission provider가 계산한다.

권고 흐름:

```txt
UserPresenceChanged(userId, status, revision)
-> Presence delivery worker
-> WorkspaceAudienceResolver: user가 속한 workspace와 각 visible recipient userId 조회
-> workspace별 PresenceBroadcastRequested
-> event bus를 통해 모든 Gateway에 전달
-> 각 Gateway는 recipient userId의 local sessions만 찾아 push
```

책임 규칙:

- Presence store는 workspace membership table을 소유하지 않는다.
- Gateway는 workspace membership이나 recipient를 계산하지 않는다.
- Workspace provider가 privacy/visibility/block 정책을 적용한 recipient를 반환한다.
- event에는 `workspaceId`를 포함해 같은 두 사용자가 여러 workspace를 공유해도 UI scope를 구분한다.
- recipient가 없는 workspace는 publish하지 않는다.
- 같은 user의 여러 local session에는 필요에 따라 모두 전송할 수 있다.
- membership 변경과 broadcast 사이 race는 snapshot으로 복구하는 결과적 정합성을 허용한다.

대형 workspace에서 event마다 전체 member ID 배열을 복제하는 비용이 클 수 있다. MVP 규모에서는 명시적
recipient list가 Gateway를 단순하게 하지만, 규모가 커지면 workspace audience key/topic과 Gateway의
로컬 workspace subscription index를 검토한다. 어느 방식이든 Gateway가 권한 원천이 되면 안 된다.

## 13. 예상 패키지와 파일

실제 이름은 이슈 시작 시 repository 상태를 확인해 조정한다. 같은 책임 package가 이미 생겼다면 중복
package를 만들지 않는다.

### contracts

```txt
packages/realtime-chat-presence-contracts/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  src/index.ts
  test/presence-contracts.test.ts
```

공개 status, internal session command, domain event, client event, snapshot DTO와 validation schema를 소유한다.

### Presence provider

```txt
packages/realtime-chat-presence/
  README.md
  AGENTS.md
  public-docs/api.md
  public-docs/invariants.md
  owner-docs/architecture.md
  owner-docs/state-transitions.md
  owner-docs/testing.md
  src/index.ts
  src/presence-module.ts
  src/presence-policy.ts
  src/ports/presence-state-store.ts
  src/usecases/register-session/...
  src/usecases/renew-session-lease/...
  src/usecases/close-session/...
  src/usecases/record-activity/...
  src/usecases/set-manual-status/...
  src/usecases/reap-expired-sessions/...
  src/usecases/get-workspace-presence/...
  test/presence-policy.test.ts
  test/presence-usecases.test.ts
```

### Redis adapter

```txt
packages/realtime-chat-presence-redis/
  README.md
  AGENTS.md
  public-docs/integration.md
  owner-docs/key-layout.md
  src/index.ts
  src/presence-redis-store.ts
  src/scripts/register-session.lua
  src/scripts/renew-session.lua
  src/scripts/close-session.lua
  src/scripts/reap-sessions.lua
  test/presence-redis.integration.test.ts
```

작은 구현이면 Presence package 내부 adapter로 시작할 수 있다. Redis key/layout과 Lua가 Presence 정책과
같이 바뀐다면 억지로 별도 package로 분리하지 않는다.

### Gateway lifecycle와 delivery

```txt
packages/realtime-chat-gateway/                       # 도입되는 경우
  README.md
  public-docs/api.md
  public-docs/invariants.md
  owner-docs/session-lifecycle.md
  src/session/local-session-registry.ts
  src/presence/presence-session-client.ts
  src/presence/presence-delivery-handler.ts
  test/presence-session-lifecycle.test.ts
  test/presence-delivery-handler.test.ts

apps/realtime-chat-gateway/
  .env.example
  README.md
  public-docs/runtime-contract.md
  owner-docs/runtime-operations.md
  src/app.ts
  src/config/env.ts
  src/runtime/create-runtime-deps.ts
  src/runtime/realtime-chat-api-client.ts              # 내부 API 방식을 택할 때
  test/app-smoke.test.ts
  test/env.test.ts
```

현재 앱의 `sessions` Map과 lifecycle 로직이 계속 커지면 `packages/realtime-chat-gateway`로 내린다. 앱은
WebSocket 서버 실행, 설정, 조립과 종료만 소유한다.

### API, delivery, workspace integration

```txt
packages/realtime-chat-presence-delivery/
  README.md
  public-docs/integration.md
  src/workspace-audience-resolver.ts
  src/presence-broadcast-handler.ts
  test/workspace-audience.test.ts

apps/realtime-chat-api/
  .env.example
  README.md
  public-docs/runtime-contract.md
  owner-docs/runtime-operations.md
  src/app.ts
  src/config/env.ts
  src/runtime/create-runtime-deps.ts
  test/app-smoke.test.ts
```

Presence를 별도 deployable service/worker로 분리할지는 부하와 ownership을 보고 결정한다. API 앱에
조립하더라도 Presence 정책과 Redis script를 앱 파일에 직접 넣지 않는다.

### web

```txt
apps/web/src/features/presence/...
apps/web/src/features/chat/transport/<실제-transport>.ts
```

web은 workspace snapshot과 status change event를 userId/revision 기준으로 model에 반영한다.

## 14. 단계별 구현

1. **identity와 workspace provider 계약 확정**
   - `actorId -> userId` 해석과 workspace visible audience 조회 계약을 먼저 정한다.
2. **Presence 상태 표 확정**
   - 연결 수, idle, manual BUSY 조합별 effective status를 표와 단위 테스트로 고정한다.
   - BUSY 지속 시간과 reconnect 복원 정책을 결정한다.
3. **contracts package 구현**
   - internal session command, domain transition, client event, snapshot schema를 정의한다.
   - session 내부 정보 비노출과 revision 규칙을 public invariant로 둔다.
4. **Presence core 구현**
   - pure policy와 register/renew/close/activity/manual/reap 유스케이스를 작성한다.
   - 동일 effective status에는 event를 만들지 않는다.
5. **Redis atomic adapter 구현**
   - session ownership, lease, global active count, state revision과 stale reaping을 Lua/transaction으로
     원자화한다.
6. **Gateway lifecycle 연결**
   - ticket 인증 완료 뒤에만 session register를 보낸다.
   - close, heartbeat timeout, graceful shutdown을 idempotent close/lease 흐름에 연결한다.
   - 로컬 Map count로 ONLINE/OFFLINE을 만들지 않는다.
7. **lease renew와 reaper worker 구현**
   - TTL/renew/reap 주기를 설정하고 다중 worker claim을 검증한다.
   - Redis restart 뒤 기존 session 재등록 동작을 구현한다.
8. **activity/AWAY 구현**
   - client 신호를 throttle하고 idle deadline 처리에서 최신 activity/revision을 재확인한다.
9. **manual BUSY command 구현**
   - 인증된 user 자신만 변경할 수 있게 하고 자동 AWAY보다 우선 적용한다.
10. **workspace audience와 event delivery 구현**
    - Workspace provider가 계산한 recipient만 fan-out한다.
    - Gateway는 local recipient session lookup과 push만 한다.
11. **snapshot/query 구현**
    - workspace 입장/재접속 시 현재 상태를 다시 맞출 수 있게 한다.
12. **관측성과 장애 검증 추가**
    - lease renew 실패, stale reaping, event lag, Redis restart, Gateway kill 시나리오를 검증한다.
13. **문서 승격**
    - 확정된 public contract와 owner 결정만 각 package 문서에 반영하고 이 notes는 AGENTS route에 넣지
      않는다.

## 15. 테스트 계획

### Presence policy 단위 테스트

- active count 0이면 manual BUSY가 남아 있어도 effective OFFLINE이다.
- active count 1 이상이며 BUSY이면 idle 여부와 관계없이 BUSY다.
- 여러 session 중 하나라도 최근 활동이면 ONLINE이다.
- 모든 활성 session이 idle이면 AWAY다.
- BUSY 해제 시 최신 activity에 따라 ONLINE 또는 AWAY가 된다.
- 동일 effective status 재계산은 revision/event를 만들지 않는다.
- 마지막 session 제거에서만 OFFLINE transition이 생긴다.

### Redis 통합 테스트

- 서로 다른 Gateway에서 같은 user session을 동시에 register해도 ONLINE transition은 한 번이다.
- 두 session 중 하나를 닫아도 OFFLINE이 되지 않는다.
- 마지막 session close에서만 OFFLINE과 revision 증가가 생긴다.
- register, renew, close가 같은 sessionId에 대해 멱등이다.
- 잘못된 gateway instance가 다른 session을 renew/close하지 못한다.
- close와 lease reaper가 경쟁해도 active count가 음수가 되거나 OFFLINE이 중복 발행되지 않는다.
- Gateway crash를 흉내 내 renew를 중단하면 TTL 뒤 stale session이 제거된다.
- 다른 Gateway의 session이 남으면 reaper 뒤에도 OFFLINE이 아니다.
- Redis restart 뒤 renew/re-register로 ONLINE 상태가 회복된다.
- idle deadline과 최근 activity가 경쟁해도 늦은 timer가 ONLINE을 AWAY로 덮어쓰지 않는다.

실제 Redis container에서 script 원자성과 TTL을 검증한다. 메모리 fake만으로 서버군 동시성과 crash 복구를
완료 판정하지 않는다.

### Gateway 통합 테스트

- ticket 인증 성공 전에는 Presence session을 등록하지 않는다.
- 인증 성공 session마다 전역 고유 sessionId와 gatewayInstanceId를 전달한다.
- 한 socket close를 여러 경로에서 관찰해도 close command는 멱등이다.
- ping/pong timeout은 socket terminate와 Presence close/lease expiry로 이어진다.
- Presence API/store 장애가 local session Map을 잘못 삭제하거나 Chat socket을 임의로 인증 해제하지
  않는다.
- graceful shutdown은 best-effort close 후 lease expiry fallback을 남긴다.
- 로컬 Map이 0이 돼도 다른 Gateway session이 있으면 OFFLINE을 발행하지 않는다.

### audience와 delivery 통합 테스트

- status 변경은 같은 workspace의 visible members에게만 전달된다.
- workspace를 공유하지 않는 사용자에게는 전달되지 않는다.
- private/blocked/visibility 정책은 Workspace provider 결과를 따른다.
- 동일 event 재처리는 user revision으로 client 상태를 중복 또는 역행시키지 않는다.
- recipient가 offline이면 socket push는 생략하고 snapshot에서 최신 상태를 복구한다.
- 같은 user가 여러 workspace를 공유할 때 event의 workspace scope가 유지된다.

### E2E

```txt
Given user A가 Gateway 1과 Gateway 2에 각각 한 탭으로 연결되어 있고
When Gateway 1의 탭이 닫히면
Then user A는 OFFLINE이 아니며
And workspace 구성원에게 OFFLINE event가 전달되지 않는다.
```

```txt
Given user A의 유일한 Gateway 프로세스가 SIGKILL로 종료되고 close event가 없으며
When session lease와 stale grace가 만료되면
Then user A는 OFFLINE이 되고
And 같은 workspace의 허용된 사용자만 상태 변경을 받는다.
```

```txt
Given user A가 두 탭 중 한 탭에서 계속 활동하고 다른 탭은 idle이며
When idle threshold가 지나면
Then user A는 AWAY가 아니라 ONLINE이다.
```

```txt
Given user A가 BUSY를 수동 설정하고 활성 session이 있으며
When idle threshold가 지나면
Then effective status는 BUSY이고
When 마지막 session이 종료되면
Then effective status는 OFFLINE이다.
```

## 16. 관측성

### metric 후보

- `gateway_local_sessions{gateway_id,instance_id}`
- `presence_global_active_sessions`
- `presence_users_by_status{status}`
- `presence_session_register_total{result}`
- `presence_session_close_total{reason}`
- `presence_lease_renew_total{result}`
- `presence_lease_renew_failures_total`
- `presence_stale_sessions_reaped_total`
- `presence_status_transitions_total{from,to,reason}`
- `presence_transition_duplicate_suppressed_total`
- `presence_event_publish_failures_total`
- `presence_event_delivery_lag_seconds`
- `presence_audience_size`는 bucket/histogram으로 기록해 user ID label을 피함
- `presence_snapshot_requests_total{result}`

### 구조화 로그

session register/close/reap에는 `sessionId`, `gatewayId`, `gatewayInstanceId`, reason, result와 correlation ID를
남긴다. ticket 원문, socket URL query, IP, device fingerprint, 모든 recipient user ID 목록은 로그에 남기지
않는다. userId가 개인정보로 취급되면 hash 또는 내부 correlation key를 사용한다.

### 경보 후보

- lease renew 실패율 급증
- stale reaper 지연이 TTL을 초과
- event stream consumer lag 증가
- Redis command/script 오류
- global session count와 Gateway local count 합의 장기 편차
- workspace audience resolver 실패율 증가

로컬 count 합과 global count는 순간적으로 다를 수 있으므로 즉시 오류로 보지 않고 허용 지연을 둔다.

## 17. 완료 조건

- 로컬 Map이 아닌 공유 state store가 서버군 전체 first/last active session을 원자적으로 판정한다.
- 서로 다른 Gateway의 다중 탭 중 하나가 종료돼도 OFFLINE이 발생하지 않는다.
- 마지막 session 정상 close 또는 lease expiry에서만 OFFLINE transition이 발생한다.
- Gateway crash와 Redis restart 이후 상태가 정의된 시간 안에 수렴한다.
- `OFFLINE -> BUSY -> AWAY/ONLINE`이 단순 덮어쓰기가 아니라 명시된 effective status 규칙을 따른다.
- BUSY가 자동 AWAY보다 우선하고 active count 0에서는 OFFLINE이 우선한다.
- 상태 변경에 revision이 있고 중복·역순 event가 client 상태를 되돌리지 않는다.
- Workspace provider가 recipient를 계산하며 전역 broadcast가 없다.
- client event에 session count와 내부 session 식별자가 노출되지 않는다.
- initial/reconnect snapshot으로 유실된 Presence event를 복구할 수 있다.
- Redis 동시성, TTL/reaper, 다중 Gateway, crash 시나리오가 통합/E2E 테스트를 통과한다.
- metric, 구조화 로그, 주요 장애 경보가 마련돼 있다.
- 확정된 계약이 provider README/public docs에, 내부 상태/키/복구 규칙이 owner docs에 반영돼 있다.
- 이 notes 문서는 agent route에 포함되지 않는다.

## 18. 비범위

- Chat message 저장, sequence, read cursor, unread 계산
- typing indicator와 커서 공유 같은 실시간 협업 signal
- 메시지 delivery/read receipt
- 사용자별 last seen 시각 공개
- device 목록이나 접속 위치 공개
- 채널별 Presence와 음성 회의 참가 상태
- push notification 상태
- workspace membership 관리 자체
- 모든 과거 Presence transition의 영구 감사 로그
- 자동 일정/캘린더 연동 BUSY
- 세밀한 사용자 정의 상태 문구와 emoji

## 19. 위험과 미결정

1. **identity 미확정**: `actorId`와 persistent `userId`의 관계가 정해지지 않았다.
2. **workspace provider 부재**: membership과 visible audience의 기준 상태가 현재 저장소에 없다.
3. **Redis client/운영 미구현**: compose service는 있지만 client package, 인증, timeout, pool, TLS 운영 계약이
   없다.
4. **Redis persistence 비활성**: restart 직후 모든 session 상태가 사라진다. 허용할 수렴 지연을 정해야
   한다.
5. **event transport 미결정**: Pub/Sub의 유실 허용과 Streams/outbox 복잡도 사이 선택이 필요하다.
6. **lease parameter**: renew interval, TTL, offline grace가 offline 감지 지연과 오탐을 결정한다.
7. **manual BUSY 저장 기간**: Redis restart/재접속 뒤 유지할지, 만료 시간을 둘지 미정이다.
8. **AWAY activity 정의**: browser focus, 사용자 입력, message/read command 중 무엇을 활동으로 볼지 UX·개인정보
   결정이 필요하다.
9. **network partition**: client socket은 살아 있지만 Presence lease만 만료되는 상황에서 Chat 연결을 유지할지
   정해야 한다.
10. **대형 workspace fan-out**: recipient 배열 복제와 fan-out 비용이 급격히 커질 수 있다.
11. **membership race**: 탈퇴 직전/직후 event가 전달될 수 있다. snapshot과 Gateway-side 재검증 수준을
    정해야 한다.
12. **Gateway package 경계**: 현재 lifecycle이 앱에 있어 Presence를 직접 더하면 앱 비대화가 가속된다.
13. **multi-region**: Redis 단일 region clock/lease 전제를 넘으면 상태 전환과 revision 전략을 다시 설계해야
    한다.
14. **status privacy**: workspace role, block, invisible mode에 따라 Presence를 숨기는 요구가 추가될 수 있다.

## 20. 문서 경계 메모

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 배경 자료다.
- consumer가 읽을 공개 계약 후보는 다음 위치다.
  - `packages/realtime-chat-presence-contracts/README.md`
  - `packages/realtime-chat-presence-contracts/public-docs/api.md`
  - `packages/realtime-chat-presence-contracts/public-docs/invariants.md`
  - `packages/realtime-chat-presence/README.md`
  - `packages/realtime-chat-presence/public-docs/api.md`
  - `packages/realtime-chat-presence/public-docs/invariants.md`
  - `packages/realtime-chat-presence-redis/public-docs/integration.md`
  - `apps/realtime-chat-api/public-docs/runtime-contract.md`
  - `apps/realtime-chat-gateway/public-docs/runtime-contract.md`
- consumer에서는 provider의 `AGENTS.md`, `owner-docs/`, `notes/`를 기본 문맥으로 읽지 않는다.
- owner는 각 provider `AGENTS.md`가 가리키는 `owner-docs/*`를 읽는다.
- 이 notes 파일을 owner 또는 consumer AGENTS route에 포함하지 않는다.
- parent directory deny 뒤 child public docs를 재개방하는 permission 구조는 사용하지 않는다.
