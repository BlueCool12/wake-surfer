# 08. 실시간 문자 채팅 Command·Event 카탈로그

## 1. 문서 목적과 해석 규칙

이 문서는 현재 구현된 Gateway/API 흐름과 이 문서 세트가 채택한 정책을 같은 표에서 추적하기 위한
카탈로그다. 제품의 최종 기능 요구사항이나 구현 약속이 아니다. `P`는 학습 프로젝트가 선택한
**Project Decision**이며 현재 구현 완료를 뜻하지 않는다. 아직 결정하지 않은 이름이나 세부 동작만
`미결정(Open)`으로 표시한다.

종류는 다음처럼 구분한다.

| 종류 | 이 문서에서의 의미 |
| --- | --- |
| Command | 클라이언트, Gateway 또는 API가 상태 변경이나 조회 처리를 요청하는 의도 |
| Domain Event | Chat 도메인에서 이미 발생한 사실. wire로 전달되는 모양과 도메인 사실 자체는 구분한다. |
| Control Event | 연결, 명령 결과, 동기화, 오류처럼 프로토콜 진행을 제어하는 응답 또는 신호 |
| Ephemeral Event | 현재 시점에만 의미가 있고 일반 메시지 이력처럼 재생하지 않는 신호 |
| Derived State | Command/Event와 저장 상태를 계산해서 만든 클라이언트 또는 Gateway의 상태 |

구현 상태 표기는 다음과 같다.

| 상태 | 의미 |
| --- | --- |
| `현행` | 현재 실행 경로와 계약에서 확인됨 |
| `P` | 학습 프로젝트가 채택한 정책 또는 모델 |
| `미구현` | 해당 이름 또는 행동이 현재 실행 경로에는 없음. P/Open 여부는 별도로 표시 |
| `미결정(Open)` | 후속 판단이 필요한 이름·wire·저장·ordering 세부 사항 |
| `P: 미채택` | 프로젝트 결정으로 도입하지 않는 별도 command/event |

표의 capability는 이 문서 세트의 P 권한 모델에서 사용하는 판정 이름이다. `미집행`은 현재 Gateway/API가
그 capability를 실제로 조회하지 않는다는 뜻이다.

## 2. 현재 구현을 읽을 때 고정할 사실

1. WebSocket wire는 `{ "type": "<event>", ...payload }`인 flat JSON 객체다.
   별도의 공통 `eventId`, `sequence`, `sessionId` envelope는 없다.
   ([wire-frame.ts](../../apps/realtime-chat-gateway/src/protocol/wire-frame.ts#L1-L38))
2. `chat.message.accepted`는 API가 반환한 저장 결과다. 현재 API에서는 message transaction이 commit된
   뒤 반환되므로 **저장 완료 ACK**로 해석할 수 있지만, 다른 연결에 대한 delivery 완료 ACK는 아니다.
   ([send-message.usecase.ts](../../packages/realtime-chat-message-send/src/usecases/send-message/send-message.usecase.ts#L133-L154))
3. `OutboundMessageDeliveryRequested` 계약과 선택적 publish 호출부는 존재하지만, 실제 API 런타임은
   `publishDeliveryRequested`를 주입하지 않는다. 따라서 현재 실행 구성에서 이 outbound event는
   발행되지 않는다.
   ([create-runtime-deps.ts](../../apps/realtime-chat-api/src/runtime/create-runtime-deps.ts#L60-L67),
   [message-send-module.ts](../../packages/realtime-chat-message-send/src/message-send-module.ts#L122-L129))
4. 현재 fan-out은 outbound event를 소비해서 일어나지 않는다. Gateway가 API의 accepted response를 받은
   직후 같은 인스턴스의 로컬 channel 구독 session을 순회해 `chat.message.created`를 직접 보낸다.
   다중 Gateway fan-out과 durable broker는 없다.
   ([Gateway app.ts](../../apps/realtime-chat-gateway/src/app.ts#L347-L381))
5. `chat.message.created`는 `PublicMessage`를 flat payload로 옮긴 **Gateway wire 전달물**이다. 독립
   `eventId`가 없고, event 자체도 저장되지 않는다. payload의 `messageId`와 message의 stream
   `sequence`는 있지만 이것을 독립 event identity와 혼동하지 않는다. 누락 시 복구되는 것은 동일 wire
   event가 아니라 DB의 message를 담은 sync response다.
6. Gateway는 같은 API response에 대해 송신자 socket의 `chat.message.accepted`를 먼저 enqueue한 뒤
   local fan-out의 `chat.message.created` send를 시작하고, 모든 send 완료를 함께 기다린다. 따라서 같은
   송신자 socket의 enqueue 순서는 accepted가 먼저지만, accepted 전달 성공을 확인한 뒤 fan-out하는
   구조는 아니다. 서로 다른 message command가 동시에 처리될 때의 fan-out 순서는 stream sequence로
   직렬화하지 않는다.
7. session과 channel 구독은 Gateway 인스턴스 메모리에만 있다. 재연결하면 새 `sessionId`와
   `connectionGeneration`이 생기고 클라이언트가 channel join과 sequence sync를 다시 수행한다. 기존
   Gateway session을 이어 쓰는 resume protocol은 없다.

## 3. Command 카탈로그

### 3.1 현행 Command

| 이름 / 현재 transport | 생성 → 수신 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| `IssueGatewayTicket` / `POST /realtime-chat/gateway-tickets` | Browser → API | 현행 trusted/asserted actor context. verified Auth principal 연결은 미구현이며 별도 Chat capability는 없음 | 요청별 처리. 명령 dedupe key 없음 | ticket hash·할당 Gateway·만료·소비 시각을 DB에 저장. 원문 ticket은 응답으로 한 번 전달 | `SC-CON-001`, `FS-CON-002`, `FS-CON-003` | ticket 처리 `현행`; Auth principal 경계 미구현 |
| `ConnectWithGatewayTicket` / WS upgrade query `ticket` | Browser → Gateway → API ticket consume | 허용 Origin/path, 유효하고 미소비인 일회성 ticket | ticket consume은 원자적 1회 처리. 재사용은 거절 | session은 Gateway 메모리 전용. 연결 재생/resume 없음 | `SC-CON-001`, `SC-CON-002`, `FS-CON-001`, `FS-CON-007`, `FS-CON-008` | `현행` |
| `AuthenticateConnection` / ticket consume 논리 단계 | Gateway → API | `ConnectWithGatewayTicket`의 허용된 upgrade와 제시된 ticket | ticket consume 성공이 connection actor를 한 번 확정 | consumed 시각은 ticket row에 저장하고 별도 auth command/event log는 없음 | `SC-CON-001`, `SC-CON-002`, `FS-CON-002`, `FS-CON-003` | 인증 단계 `현행` · 별도 client auth frame `P: 미채택` |
| `SubscribeConversation` / 현행 `JoinChannel` (`chat.channel.join`) | Browser → Gateway local session | session `ready`; P capability `conversation:view`, `conversation:subscribe`. 현재 capability·membership 미집행 | 같은 `channelId`는 `Set` 추가라 session 안에서 결과상 멱등. command ID와 성공 ACK 없음 | channel set은 연결 메모리 전용. 새 connection generation마다 클라이언트가 재전송 | `SC-CON-004`, `FS-SUB-001`~`FS-SUB-005` | `P` 이름 · `현행` transport |
| `SendMessage` / `chat.message.send` → internal HTTP | Browser → Gateway → API message-send | ready session, Gateway 로컬 channel join, text 계약. P capability `conversation:view`, `message:create`. API 현행은 모든 channel 허용, DM/thread 거절 | stream `sequence`가 저장 순서. `(senderActorId, streamId, clientMessageId)`로 멱등. optional `commandId`는 correlation일 뿐 dedupe key가 아님 | message는 DB 저장. command와 ACK는 별도 저장·재생하지 않음. 재시도에는 기존 message 반환 | `SC-MSG-001`~`SC-MSG-003`, `FS-MSG-001`~`FS-MSG-009`, `FS-MSG-013`, `FS-MSG-014` | `현행` |
| `CatchUpConversation` / 현행 `SyncAfterMessages` (`chat.stream.sync`) | Browser → Gateway → API Stream Messages | ready session. P capability `conversation:view`, `history:read`; 현재 API read authorizer는 모든 channel 허용 | `requestId`로 응답 correlation. cursor는 `afterSequence`; 최초 page의 `throughSequence`를 batch watermark로 고정. 같은 session/channel의 동시 요청은 일시 rate limit | 요청/응답 event는 저장하지 않음. DB message를 sequence 범위로 조회. 클라이언트가 delivery cursor를 page-lifetime 메모리에 저장 | `SC-CON-005`, `SC-MSG-003`, `FS-MSG-007`~`FS-MSG-009`, `FS-SYNC-001`, `FS-SYNC-004`, `FS-SYNC-005` | `P` 이름 · `현행` transport |
| `LoadLatestMessages` / public HTTP latest | Browser → API | 현행 asserted actor context. P capability `conversation:view`, `history:read`; 현재 모든 channel 허용 | 응답의 `throughSequence`가 초기 delivery cursor. message identity/sequence 검증 | DB message 조회. 응답 자체는 저장·재생하지 않음 | `SC-CON-005` | 조회 `현행`; Auth principal·capability 집행 미구현 |
| `LoadOlderMessages` / public HTTP older | Browser → API | 현행 asserted actor context. P capability `conversation:view`, `history:read`; 현재 모든 channel 허용 | `beforeSequence` 기준 과거 방향 pagination | DB message 조회. 화면 history cursor는 client derived state | `SC-MSG-011`, `FS-SUB-003`, `FS-SYNC-007` | pagination `현행`; Auth principal·capability 집행 미구현 |
| `CloseConnection` / WebSocket close | Browser 또는 Gateway → 상대 endpoint | 열린 연결 | close frame/code 단위. command dedupe 없음 | session·local subscription 제거, 진행 중 sync 취소. 기존 session replay 없음 | `SC-CON-006`, `FS-CON-001`, `FS-CON-007` | `현행` |

`SendMessage`의 현재 target 계약은 channel/DM/thread를 모두 표현할 수 있지만 Gateway는 join된 channel
target만 API로 중계한다. API 기본 target resolver는 존재 여부를 확인하지 않고 canonical stream ID와 빈
recipient 목록을 만든다. 그러므로 현행 runtime에서 `target_not_found`는 정상 조립 경로로 발생하지
않는다.

### 3.2 P Command와 미결정(Open) 범위

| 이름 / transport | 생성 → 수신 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| `ListAccessibleConversations` | Browser → Conversation query owner | active principal; `conversation:view` | 권한 projection version과 pagination은 `미결정(Open)` | 접근 가능한 conversation projection 조회; Chat Gateway session에는 저장하지 않음 | `SC-CON-003`, `FS-SUB-002` | `P` · `미구현` |
| `UnsubscribeConversation` | Browser → Gateway | 구독 중; 본인 connection의 subscription | connection+conversation 범위에서 반복 해제는 결과상 멱등 | local subscription에서 제거하며 영속 command로 저장하지 않음 | `SC-CON-007`, `FS-SUB-006` | `P` · `미구현` |
| `RestoreSubscription` / client orchestration | 새 Connection의 Browser → Gateway/API | Connection Ready; 이전에 활성화할 conversation의 view·subscribe·history 권한 | 새 `connectionGeneration`과 conversation별로 실행; 동일 generation의 중복 구독은 결과상 멱등 | 이전 Gateway Session을 복원하지 않고 `SubscribeConversation` 뒤 `CatchUpConversation`을 수행 | `SC-CON-004`, `SC-CON-005`, `FS-CON-007`, `FS-CON-008` | `P` · 전용 wire command `미구현` |
| `EditMessage` | Browser → Gateway/API | message 존재·미삭제, 소유권 또는 moderation; `message:edit_own` | expected message version으로 동시 수정을 비교한다. wire 필드와 별도 `commandId` 필요 여부는 `미결정(Open)` | 수정 결과와 편집 이력 저장 범위는 `미결정(Open)` | `SC-MSG-004`, `FS-MSG-010`~`FS-MSG-012` | `P` · `미구현` |
| `DeleteMessage` | Browser → Gateway/API | message 존재, `message:delete_own` 또는 `message:delete_any` | 중복 삭제, 수정과 삭제 경합 결과는 `미결정(Open)` | tombstone·hard delete·감사 이력 정책은 `미결정(Open)` | `SC-MSG-005`, `SC-MSG-006`, `FS-MSG-010`, `FS-MSG-012` | `P` · `미구현` |
| `ReplyMessage` | Browser → Gateway/API | parent message 접근 가능; `message:create` | 일반 message와 같은 conversation sequence와 `clientMessageId` 멱등성 | reply relation을 가진 `MessageCreated`를 저장 | `SC-MSG-007`, `FS-MSG-015` | `P` · `미구현` |
| `ReplyThreadMessage` | Browser → Gateway/API | parent 접근 가능; `thread:create` 또는 `thread:reply` | thread canonical stream 안에서 ordering하며 정확한 `streamId`와 parent mapping은 `미결정(Open)` | `ThreadCreated`와 thread `MessageCreated`를 보존하되 물리 저장 모델·replay 계약은 `미결정(Open)` | `SC-MSG-008`, `FS-MSG-015` | `P` · `미구현` |
| `AddReaction` | Browser → Gateway/API | message 접근 가능; `reaction:add` | `(actorId, messageId, emoji)`를 결과상 중복 기준으로 사용 | 현재값/변경 이력 보관과 replay 기준은 `미결정(Open)` | `SC-MSG-009`, `FS-MSG-016` | `P` · `미구현` |
| `RemoveReaction` | Browser → Gateway/API | 자기 반응 또는 moderation; `reaction:remove_own`, `reaction:remove_any` | 없는 반응 제거는 결과상 멱등 | reaction 상태 저장 방식은 `미결정(Open)` | `SC-MSG-009`, `FS-MSG-016` | `P` · `미구현` |
| `StartTyping` | Browser → Gateway | ready·conversation 접근; `typing:publish` | actor·conversation 최신 상태 우선; coalescing/TTL 값은 `미결정(Open)` | 일반 message replay 대상이 아니며 TTL 저장 방식은 `미결정(Open)` | `SC-EPH-001`, `FS-EPH-001` | `P` · `미구현` |
| `StopTyping` | Browser 또는 TTL 만료 처리 → Gateway | typing 상태가 있거나 만료됨; `typing:publish` | 중복 stop은 결과상 멱등 | 일반 message replay 대상 아님 | `SC-EPH-002`, `FS-EPH-002` | `P` · `미구현` |
| `AdvanceReadCursor` | Browser → API/Gateway | message history 접근; `read_cursor:update` | actor+conversation cursor는 뒤로 이동시키지 않음 | 같은 actor의 device에 공유한다. 영속·fan-out·offline 조회 계약은 `미결정(Open)` | `SC-READ-001`~`SC-READ-003`, `FS-READ-001`, `FS-READ-002` | `P` · `미구현` |
| `FullSyncConversation` / 이전 이름 `RequestFullSync` | Browser recovery model → API/Gateway | delivery sync의 `invalid_cursor` 또는 authoritative baseline 재구축 필요 | 해당 conversation만 기존 delivery cursor를 무효화; 요청 correlation 세부는 `미결정(Open)` | latest baseline을 새 cursor로 삼고 이후 gap을 catch-up; 별도 wire command 형태는 `미결정(Open)` | `SC-CON-005`, `FS-SYNC-004`~`FS-SYNC-006` | `P` · orchestration `미구현` |
| `LogoutDevice` | Browser → Auth/session owner | 본인 device session 관리 | stable device session identity는 `미결정(Open)` | 선택한 device의 auth session 무효화는 Chat 외부 소유 | `SC-MULTI-003`, `FS-MULTI-001` | `P` · `미구현` |
| `LogoutAllDevices` | Browser → Auth/session owner | 본인 actor-wide session 관리 | actor-wide revocation identity/version은 `미결정(Open)` | actor의 모든 auth session 무효화는 Chat 외부 소유 | `SC-MULTI-003`, `FS-MULTI-001` | `P` · `미구현` |
| `ResumeSession` / transport session resume | Browser → Gateway | 이전 `sessionId`·resume token을 재사용하는 전제 | P-RS-001은 이전 transport session을 재사용하지 않음 | Gateway session/replay log가 현재 없고 P도 이 command를 도입하지 않음 | `FS-CON-006`~`FS-CON-008`, `FS-SYNC-006` | `P: 미채택` · `미구현` |

### 3.3 이름과 alias

| P 이름 | 현행 또는 이전 이름 | 관계 |
| --- | --- | --- |
| `SubscribeConversation` | `JoinChannel` / `chat.channel.join` | 현행 local join transport에 P의 conversation subscription 의미를 부여한다. |
| `CatchUpConversation` | `SyncAfterMessages` / `chat.stream.sync` | 현행 cursor 이후 message 조회를 P의 conversation catch-up command로 부른다. |
| `FullSyncConversation` | `RequestFullSync` | 이전 카탈로그 이름을 P 이름으로 정규화한다. 현행 전용 command는 없다. |
| `RestoreSubscription` | 별도 현행 alias 없음 | 새 session에서 `SubscribeConversation + CatchUpConversation`을 조율하며 transport session을 resume하지 않는다. |
| `ListAccessibleConversations` | 별도 현행 alias 없음 | active principal의 접근 가능 conversation projection 조회다. |
| `ReplyMessage` | `ReplyThreadMessage`와 별개 | 기존 conversation message에 reply relation을 추가하는 command이며 thread 생성·답글과 구분한다. |
| `LogoutDevice`, `LogoutAllDevices` | 별도 현행 alias 없음 | Chat Gateway command가 아니라 외부 Auth/session owner와 연결되는 P command다. |
| `ResumeSession` | 별도 현행 alias 없음 | P-RS-001에 따라 transport command로는 **미채택**이다. Resume은 `RestoreSubscription + CatchUpConversation` 과정이다. |

여기서 P-RS-001은 [10-reconnect-resume-sync-policy.md](./10-reconnect-resume-sync-policy.md)의
transport session 비재사용 결정이다. 이름별 scenario 연결은
[12-traceability-matrix.md](./12-traceability-matrix.md)의 Command coverage와 동일하게 유지한다.

## 4. Domain Event 카탈로그

### 4.1 현행 도메인 사실과 전달 projection

| 이름 | 생성 → 수신 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| `MessageCreated` 도메인 사실 | API message-send transaction → message query·응답 조립 | target resolve, content 검증, write 허용, 신규 멱등 key | `streamId` 안의 positive `sequence`; `messageId` 고유; sender/stream/clientMessageId 고유 | `messages`에 영속. message 자체는 latest/older/sync로 재조회 가능. 별도 event record/eventId는 없음 | `SC-MSG-001`~`SC-MSG-003`, `FS-MSG-003`~`FS-MSG-009` | `현행` 사실 · 독립 event record `미구현` |
| `OutboundMessageDeliveryRequested` | message-send usecase → optional publisher | 신규 message commit 완료. 수신자 계산은 target resolver 책임 | 계약상 `eventId`; message의 stream `sequence`. 기존 message 재시도 경로에서는 다시 만들지 않음 | outbox·event log 없음. publish 실패는 저장 성공과 분리해 삼킴 | `SC-MSG-003`, `FS-MSG-006`, `FS-MSG-007` | 계약·호출부 `현행`; runtime 발행 `미구현` |
| `chat.message.created` wire projection | Gateway → 같은 인스턴스의 ready channel session | Gateway가 API accepted message를 받음; local channel set 포함 | **독립 `eventId` 없음.** message `messageId`와 `(streamId, sequence)`만 있음. 같은 response의 sender socket에는 accepted를 먼저 enqueue하지만, 동시 command의 fan-out을 stream sequence로 직렬화하지 않음 | wire event는 저장/replay하지 않음. 누락 시 DB message를 `chat.stream.synced`로 복구 | `SC-MSG-003`, `SC-MULTI-002`, `FS-MSG-006`~`FS-MSG-009` | `현행` |
| `GatewayTicketIssued` 사실 | API ticket issue transaction → Browser HTTP response | 인증 actor | ticket hash가 identity. 명령 dedupe 없음 | ticket row 영속, 원문 ticket은 hash로만 저장 | `SC-CON-001`, `FS-CON-002` | `현행` 사실 · published event `미구현` |
| `GatewayTicketConsumed` 사실 | API atomic consume → Gateway | 유효·미소비·미만료·assigned Gateway 일치 | ticket별 최초 consume만 성공 | `consumed_at` 영속. 별도 event stream 없음 | `SC-CON-001`, `SC-CON-002`, `FS-CON-008` | `현행` 사실 · published event `미구현` |

`OutboundMessageDeliveryRequested`의 계약은 `eventId`, `occurredAt`, `message`,
`recipientActorIds`를 갖는다. 그러나 API의 현재 기본 resolver는 recipient를 빈 배열로 만들고 runtime은
publisher 자체를 연결하지 않는다. 이 계약의 존재만으로 broker delivery가 구현됐다고 기록하면 안 된다.

### 4.2 P Domain Event와 파생 사실

| 이름 | 생성 → 수신 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| `MessageEdited` | Chat application → conversation subscribers | 성공한 `EditMessage`; `message:edit_own` | expected message version으로 경합을 판정한다. 수정 사실의 stream ordering·version wire 표현은 `미결정(Open)` | 최종 message와 편집 이력/replay 범위는 `미결정(Open)` | `SC-MSG-004`, `FS-MSG-010`~`FS-MSG-012` | `P` · `미구현` |
| `MessageDeleted` | Chat application → conversation subscribers | 성공한 `DeleteMessage`; delete capability | 수정/삭제 경합과 중복 삭제 기준은 `미결정(Open)` | tombstone과 replay 범위는 `미결정(Open)` | `SC-MSG-005`, `SC-MSG-006`, `FS-MSG-010`, `FS-MSG-012` | `P` · `미구현` |
| `ThreadCreated` | Chat application → thread parent conversation/subscribers | 성공한 `ReplyThreadMessage`; `thread:create` | parent message와 독립 thread stream identity를 고정하며 정확한 ID 계약은 `미결정(Open)` | thread root/relation의 물리 저장 구조와 replay 범위는 `미결정(Open)` | `SC-MSG-008`, `FS-MSG-015` | `P` · `미구현` |
| `ReactionAdded` | Chat application → conversation subscribers | 성공한 `AddReaction`; `reaction:add` | actor/message/emoji identity로 결과상 중복 제거 | reaction state와 event history 범위는 `미결정(Open)` | `SC-MSG-009`, `FS-MSG-016` | `P` · `미구현` |
| `ReactionRemoved` | Chat application → conversation subscribers | 성공한 `RemoveReaction`; reaction remove capability | `ReactionAdded`와 같은 reaction identity 사용 | reaction state와 replay 범위는 `미결정(Open)` | `SC-MSG-009`, `FS-MSG-016` | `P` · `미구현` |
| `UserMentioned` 파생 사실 | `MessageCreated` 내용·구조 검증 → mention/notification projection | mention 대상이 message와 conversation에 유효; `mention:user` 또는 `mention:broadcast` | 원본 `messageId`와 mention target으로 중복 방지 | 원본 message와 함께 catch-up 가능해야 하며 별도 event 저장 여부는 `미결정(Open)` | `SC-MSG-010` | `P` · 파생 처리 `미구현` |
| `ReadCursorAdvanced` | Chat application → 동일 actor의 기기 또는 conversation projection | 성공한 cursor 갱신; `read_cursor:update` | actor·conversation cursor는 단조 증가 | 동일 actor 기기에 공유하며 영속·live fan-out·offline replay 계약은 `미결정(Open)` | `SC-READ-001`~`SC-READ-003`, `SC-MULTI-001`, `FS-READ-001`, `FS-READ-002` | `P` · `미구현` |
| `ConversationPermissionChanged` | membership/role owner → Chat permission projection | 외부 capability·role 변경 | permission projection version 기준은 `미결정(Open)` | 권한 상태의 원본 저장은 외부 context 소유; Chat 반영 log 범위는 `미결정(Open)` | `SC-AUTH-001`, `FS-AUTH-001`, `FS-MSG-004`, `FS-MSG-005` | `P` · `미구현` |
| `ConversationAccessRevoked` | membership/role 외부 context → Chat | 외부 권한 변경 | 외부 event identity/version은 `미결정(Open)` | 현재 연결·구독 해제와 재접속 시 반영 방식은 `미결정(Open)` | `SC-AUTH-002`, `FS-SUB-003` | `P` · `미구현` |
| `MemberSuspended` | moderation 외부 context → Chat | 외부 제재 변경 | 외부 event identity/version은 `미결정(Open)` | 기존 연결 종료와 저장 message 보존 정책은 `미결정(Open)` | `SC-AUTH-001`, `SC-AUTH-002` | `P` · `미구현` |

## 5. Control Event 카탈로그

### 5.1 현행 Control Event

| 이름 / wire | 생성 → 수신 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| `gateway.connected` | Gateway → 새 WebSocket | ticket consume 성공, socket open | 해당 connection에서 첫 application server event. `connectionGeneration`, `sessionId` 제공 | 미저장·미재생. 재접속 때 새 값 생성 | `SC-CON-001`, `SC-CON-002`, `FS-CON-007`, `FS-CON-008` | `현행` |
| `gateway.not_ready` | Gateway → WebSocket | session 없음, 아직 ready 아님 또는 connected event 미전송 상태에서 frame 수신 | correlation ID 없음; 입력 command와 직접 연결할 수 없음 | 미저장·미재생 | `SC-CON-002`, 인증 중 조기 command 실패 | `현행` |
| `chat.message.accepted` | Gateway → sender connection | API `status=accepted` 수신 | `clientMessageId` 필수, `commandId` optional. message의 stream sequence 포함. 같은 API response의 created fan-out보다 sender socket에 먼저 enqueue되지만 전송 성공을 먼저 확정하지는 않음 | 미저장·미재생. 유실 시 같은 `clientMessageId` 재전송 또는 sequence sync로 저장 결과 확인 가능 | `SC-MSG-002`, `FS-MSG-004`, `FS-MSG-005` | `현행` |
| `chat.message.rejected` | Gateway → sender connection | local join/target 검사 또는 API domain rejection | `clientMessageId`, optional `commandId`; reason은 `invalid_content`, `target_not_found`, `write_forbidden` | 미저장·미재생. 동일 재시도의 권한·target 결과가 유지되는지는 보장 없음 | `SC-MSG-002`, `SC-AUTH-001`, `FS-MSG-013`, `FS-MSG-014` | `현행` |
| `chat.stream.synced` | Gateway → requesting connection | 유효 sync request와 API success | `requestId` correlation; `afterSequence`, fixed `throughSequence`, `nextAfterSequence`로 page 순서 확인 | response 미저장. 포함 message는 DB 영속. client cursor에 반영 | `SC-CON-005`, `FS-MSG-009`, `FS-SYNC-001` | `현행` |
| `chat.stream.sync.rejected` | Gateway → requesting connection | domain rejection 또는 frame에 읽을 수 있는 requestId가 있는 validation 실패 | `requestId`; code `stream_unavailable`, `invalid_cursor`, `bad_request`, `rate_limited`. rate limit은 `retryAfterMs` 포함 | 미저장·미재생 | `FS-SUB-001`, `FS-SUB-002`, `FS-SYNC-004`, `FS-SYNC-005`, `FS-FLOW-002` | `현행` |
| `chat.stream.sync.failed` | Gateway → requesting connection | API/의존성 실패 | `requestId`, `stream_messages_unavailable`, `retryable: true` | 미저장·미재생. client가 cursor를 유지하고 재시도 | `FS-MSG-009`, `FS-FLOW-003` | `현행` |
| WebSocket close `4401` | Gateway → connection | ticket 없음·거절 | connection 단위, command correlation 없음 | 미저장·미재생 | `FS-CON-002`, `FS-CON-003`, `FS-CON-008` | `현행` |
| WebSocket close `1003/1008/1009/1011` | Gateway → connection | binary frame, protocol/schema 위반, frame 과대, 내부 처리 실패 | connection 종료가 ordering boundary. 개별 command result와 correlation 없음 | 미저장·미재생 | `FS-MSG-013`, `FS-MSG-014`, protocol failure | `현행` |

`chat.message.accepted`를 이 문서에서는 `Commit ACK`에 가장 가까운 현행 제어 event로 분류한다.
Gateway frame 수신만 확인하는 `Transport ACK`, broker publish 확인, 각 subscriber delivery 확인은 현재
별도로 존재하지 않는다.

### 5.2 P Control Event와 미결정(Open) 이름

| 이름 | 생성 → 수신 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| `Hello` | Gateway → new connection | socket upgrade 성공 | 현행 `gateway.connected`와 별도 단계로 나눌지 `미결정(Open)` | 저장·replay하지 않는 control 신호로 둘지도 `미결정(Open)` | `SC-CON-001` | `미결정(Open)` · `미구현` |
| `TransportAck` / `CommandReceived` | Gateway → sender | 유효 frame 수신 | command correlation ID와 Commit ACK 분리 여부가 `미결정(Open)` | 저장 여부도 `미결정(Open)` | `FS-MSG-001`, `FS-MSG-002` | `미결정(Open)` · `미구현` |
| `AuthenticationSucceeded` / `Ready` | Gateway → connection | 인증 완료 | 현행 `gateway.connected` 하나로 충분한지 단계 분리할지 `미결정(Open)` | 저장 여부 `미결정(Open)` | `SC-CON-002` | 별도 event `미결정(Open)` · `미구현` |
| `AuthenticationFailed` | Gateway → connection | 인증 실패 | 현행 close `4401` 전에 body event를 보낼지 `미결정(Open)` | 저장 여부 `미결정(Open)` | `FS-CON-002`, `FS-CON-003` | 별도 event `미결정(Open)` · `미구현` |
| `CommandAccepted` (일반 결과 개념) | command 처리 경계 → requester | 해당 command가 정의한 성공 경계 도달 | command별 correlation을 사용한다. `SendMessage`에서는 Commit ACK이며 다른 command의 성공 의미는 각 계약에서 정함 | 일반 결과 이름 자체는 저장·재생하지 않음 | 모든 mutation 시나리오 | 결과 분류 `P` · 범용 wire 이름 `미결정(Open)` |
| `CommandRejected` (일반 결과 개념) | command 처리 경계 → requester | validation·권한·대상·상태 검사 실패 | command별 correlation과 안정 error code를 사용 | 일반 결과 이름 자체는 저장·재생하지 않음 | 관련 `FS-SUB-*`, `FS-MSG-*` | 결과 분류 `P` · 범용 wire 이름 `미결정(Open)` |
| 구독 성공 결과 (`SubscriptionSucceeded`는 후보명) | Gateway → requester | join과 권한 확인 성공 | subscription active 신호는 필요하지만 wire 이름과 correlation은 `미결정(Open)` | subscription은 session-local, event 저장 여부는 `미결정(Open)` | `SC-CON-004`, `FS-SUB-004`, `FS-SUB-005` | 개념적 결과 `P` · wire 이름 `미결정(Open)` · `미구현` |
| 구독 거절 결과 (`SubscriptionRejected`는 후보명) | Gateway → requester | target 없음·접근 거부 | request correlation과 오류 code는 `미결정(Open)` | 저장 여부 `미결정(Open)` | `FS-SUB-001`~`FS-SUB-003` | 개념적 결과 `P` · wire 이름 `미결정(Open)` · `미구현` |
| `Heartbeat` | 송신 주체 `미결정(Open)` | ready connection | nonce·interval·deadline 정책은 `미결정(Open)` | 저장·replay 여부 `미결정(Open)` | `FS-CON-004`, `FS-CON-005` | `미결정(Open)` · `미구현` |
| `HeartbeatAck` | Heartbeat 수신 측 → 송신 측 | Heartbeat를 도입한 경우 | correlation 정책은 `미결정(Open)` | 저장·replay 여부 `미결정(Open)` | `FS-CON-004`, `FS-CON-005` | `미결정(Open)` · `미구현` |
| `ReconnectRequested` | Gateway → connection | drain·session 교체·장애 예방 중 어떤 사유를 지원할지 `미결정(Open)` | connection generation과 deadline 의미는 `미결정(Open)` | 저장 여부 `미결정(Open)` | `FS-CON-006`, `FS-CON-007` | `미결정(Open)` · `미구현` |
| `ResumeRequested` | reconnected client → Gateway | 이전 transport session resume을 전제 | P-RS-001은 이전 session을 재사용하지 않으므로 요청 correlation을 정의하지 않음 | transport resume metadata를 보관하지 않음 | `FS-CON-008`, `FS-SYNC-006` | `P: 미채택` · `미구현` |
| `ResumeSucceeded` | Gateway → reconnected client | 이전 transport session resume 성공을 전제 | P-RS-001은 이전 session identity/replay cursor를 복원하지 않음 | transport resume metadata를 보관하지 않음 | `FS-CON-008`, `FS-SYNC-006` | `P: 미채택` · `미구현` |
| `ResumeRejected` | Gateway → reconnected client | 이전 transport session resume 요청을 전제 | P-RS-001은 `ResumeSession` command 자체를 채택하지 않음 | 별도 resume result를 저장하지 않음 | `FS-CON-008`, `FS-SYNC-004`, `FS-SYNC-006` | `P: 미채택` · `미구현` |
| `ReplayCompleted` | Gateway/API → client | catch-up page 적용 완료 | 기존 `chat.stream.synced`와 별도 event가 필요한지 `미결정(Open)` | replay 결과는 저장 message에서 재구성 | `SC-CON-005`, `FS-SYNC-001`~`FS-SYNC-003` | 별도 event `미결정(Open)` · `미구현` |
| `FullSyncRequired` | recovery model 또는 Gateway/API → client | delivery sync의 `invalid_cursor`로 해당 conversation recovery cursor를 사용할 수 없음 | conversation identity와 원인 code로 correlation; 구체 wire 이름은 `미결정(Open)` | 해당 conversation recovery state이며 control event 자체는 저장하지 않음 | `FS-SYNC-004`~`FS-SYNC-006` | `P` · wire `미구현` |
| `ProtocolError` | Gateway → connection | correlation 가능한 복구 가능 protocol 오류 | command correlation과 구체 wire 이름은 `미결정(Open)`; correlation 불가 입력은 close | 현행은 주로 close code 사용 | malformed frame 시나리오 | 별도 event `미결정(Open)` · `미구현` |
| `RateLimited` (일반 결과 개념) | Gateway/API → requester | actor·Conversation·connection 유량 한계 초과 | 안전한 command/request correlation과 retry hint를 사용 | 저장·replay하지 않음 | `FS-FLOW-001`~`FS-FLOW-003`, `FS-EPH-001` | stream sync code는 `현행`; 범용 wire 이름·한계는 `미결정(Open)` |
| `ConnectionClosing` | Gateway → connection | graceful drain/logout | 마지막 수신 sequence와 reconnect hint 포함 여부는 `미결정(Open)` | 저장 여부 `미결정(Open)` | `SC-CON-006`, `FS-CON-006`, `FS-CON-007` | `미결정(Open)` · `미구현` |

## 6. Ephemeral Event 카탈로그

| 이름 | 생성 → 수신 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| `TypingStarted` | typing client/Gateway → conversation subscribers | conversation 접근, `typing:publish` | actor·conversation 최신 상태; TTL/coalescing 값은 `미결정(Open)` | 일반 message history에는 저장·재생하지 않음. 짧은 TTL state 방식은 `미결정(Open)` | `SC-EPH-001`, `FS-EPH-001`, `FS-EPH-002` | `P` · `미구현` |
| `TypingStopped` | typing client 또는 만료 처리 → subscribers | 기존 typing 상태 또는 TTL 만료 | 같은 actor/conversation stop 중복은 결과상 멱등 | replay하지 않음 | `SC-EPH-002`, `FS-EPH-002` | `P` · `미구현` |
| `PresenceChanged` | connection/presence owner → 허용된 viewers | source는 active principal, recipient는 `conversation:view`; 추가 공개 범위는 `미결정(Open)` | actor 최신 상태 우선; 여러 device 병합 규칙은 `미결정(Open)` | message replay 대상 아님. last-known 상태 저장 여부는 `미결정(Open)` | `SC-EPH-003`, `SC-MULTI-001`, `SC-MULTI-003`, `FS-CON-007` | `P` · `미구현` |

입력 중과 presence를 ephemeral 범주로 다루는 것은 P다. TTL 값, presence 공개 범위와 durable state
필요 여부는 `미결정(Open)`이며, 두 상태를 message와 같은 durable event stream에 넣는 결정은 없다.

## 7. Derived State 카탈로그

Derived State에는 생성·수신 대신 **계산 주체 → 관찰 주체**를 기록한다. capability는 이 상태를 계산하기
위해 선행 데이터 접근에 필요한 P 권한 이름을 뜻한다.

| 이름 | 계산 → 관찰 | 사전조건 / capability | ordering / dedupe | replay / storage | 관련 시나리오 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| Connection readiness | Gateway session + browser realtime session → UI/transport | ticket 인증 성공 | `connectionGeneration`이 새 연결 경계. 이전 generation callback/result는 현재 session과 구분 | Gateway state는 메모리. browser state는 재연결 때 재계산 | `SC-CON-001`, `SC-CON-002`, `FS-CON-001`, `FS-CON-007` | `현행` |
| Local channel subscription | Gateway `Set<channelId>` → fan-out filter | ready session; capability는 현재 미집행 | session 안에서 channelId 중복 제거 | 메모리 전용. 재접속 시 client가 join 재전송 | `SC-CON-004`, `FS-SUB-003`~`FS-SUB-005` | `현행` |
| Optimistic message status (`pending`/`failed`/`sent`) | ChatRoomModel → sender UI | nonblank text와 ready transport | `clientMessageId`로 pending/ACK 조정. reconnect sync에서는 sender+sentAtClient+text 휴리스틱도 사용 | optimistic map은 메모리. 저장 message 수신 시 `sent` projection | `SC-MSG-001`, `SC-MSG-002`, `FS-MSG-001`, `FS-MSG-004`, `FS-MSG-005` | `현행` |
| Ordered message timeline | StreamMessagesTimelineModel → chat UI | channel message 계약 | `(messageId, sequence)` identity를 교차 검증; stream sequence 오름차순. gap은 buffer 후 sync | message 원본은 DB; timeline과 cursor는 현재 page-lifetime 메모리 | `SC-CON-005`, `SC-MSG-003`, `FS-MSG-007`~`FS-MSG-009` | `현행` |
| Delivery sync cursor | Timeline/session model → recovery logic | latest 또는 연속 live/sync 적용 | 마지막 연속 stream sequence. 앞선/충돌 cursor는 protocol failure | actor/channel namespace의 page-lifetime 메모리 Map에 저장하며 browser reload를 넘지 않음 | `SC-CON-005`, `FS-SYNC-001`, `FS-SYNC-005` | `현행` |
| Recovery phase | StreamMessagesRecoveryModel → UI | connection 및 query 결과 | `loading_latest`, `recovering`, `recovery_pending`, `ready`, 각 실패 phase로 전이 | 현재 client runtime 메모리 상태다. Gateway session resume나 durable browser storage와는 다름 | `SC-CON-005`, `FS-CON-007`, `FS-CON-008`, `FS-SYNC-004`~`FS-SYNC-006` | `현행` |
| Unread count / unread marker | message timeline + read cursor → UI | `history:read`, read cursor 데이터 | stream sequence와 last-read cursor로 계산 | read cursor 저장 정책이 없어 현재 계산 불가 | `SC-READ-001`~`SC-READ-003` | `P` · `미구현` |
| Typing indicator | ephemeral typing state → conversation UI | `typing:publish` 및 view 권한 | actor별 최신 상태; TTL 값은 `미결정(Open)` | replay하지 않음 | `SC-EPH-001`, `SC-EPH-002` | `P` · `미구현` |
| Presence indicator | presence state → 허용된 UI | `conversation:view`; 추가 공개 범위 정책은 `미결정(Open)` | multi-device 상태 병합은 `미결정(Open)` | last-known 저장 여부는 `미결정(Open)` | `SC-EPH-003`, `SC-MULTI-001`, `SC-MULTI-003` | `P` · `미구현` |
| Message delivered/read status | delivery/read signals → sender UI | delivery와 read 정의 필요 | connection ACK, user ACK, read cursor 중 어느 기준인지 `미결정(Open)` | 보관·replay 정책은 `미결정(Open)` | `SC-MSG-002`, `SC-READ-001`, `SC-MULTI-002` | `미결정(Open)` · `미구현` |

## 8. 현재 ACK 의미 요약

| 관찰 지점 | 현재 존재하는 신호 | 현재 확인 가능한 의미 | 확인할 수 없는 의미 |
| --- | --- | --- | --- |
| Gateway frame 수신 | 별도 ACK 없음 | 유효하지 않은 frame이면 거절/close될 수 있음 | API 전달 여부, 저장 여부 |
| API command 결과 | `SendMessageResponse` | accepted이면 message transaction commit 완료; rejected이면 알려진 domain 거절 | subscriber delivery |
| sender WebSocket | `chat.message.accepted` | API accepted 결과를 sender socket send callback까지 전달 시도 | sender application 반영, 다른 client 수신 |
| local fan-out | `chat.message.created` | 해당 Gateway 인스턴스의 구독 socket에 message wire 전송 시도 | 독립 event 저장, cross-Gateway 전달, application 소비 |
| 누락 복구 | `chat.stream.synced` | DB message를 고정 watermark 범위에서 sequence 조회 | 원래 `chat.message.created` event의 eventId 기반 replay |

## 9. 미결정(Open)

다음은 이 문서가 발견한 질문이며 최종 요구사항이 아니다.

- 저장 ACK와 transport 수신 ACK를 별도 제어 event로 나눌지
- heartbeat를 도입할지, 도입한다면 주체, interval, deadline과 ACK 형식을 어떻게 정할지
- `chat.message.created`보다 상위에 독립적이고 replay 가능한 domain event identity가 필요한지
- outbound delivery에 broker/outbox를 둘지, 현재 local fan-out을 어떤 단계까지 유지할지
- channel join 시 실제 membership/capability를 어디서 확인하고 성공·거절 ACK를 둘지
- `RestoreSubscription`을 단일 client orchestration으로 둘지 세부 wire command로 둘지
- typing·presence를 어느 범위까지 저장·multi-device 전달할지와 actor 단위 read cursor의 영속·fan-out
  계약

이 목록에 `ResumeSession` transport command 도입 여부는 포함하지 않는다. P-RS-001이 이전 Gateway
Session을 재사용하지 않기로 결정했으며, 이 카탈로그의 Resume은 새 Session에서
`RestoreSubscription + CatchUpConversation`을 수행하는 과정이다.
