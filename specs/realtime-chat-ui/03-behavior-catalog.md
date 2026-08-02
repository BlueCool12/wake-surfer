# 03. 문자 채팅 행동 카탈로그

## 문서 목적

이 문서는 Discord와 Slack 중 어느 서비스가 더 많은 기능을 제공하는지 비교하지 않는다. 공개적으로
확인 가능한 사용자 행동과 공식 개발자 문서를 탐색의 출발점으로 삼고, wake-surfer에서 다룰 문자 채팅
행동을 일관된 카드로 기록한다.

각 카드는 다음을 분리한다.

- 사용자가 하는 행동과 사용자가 볼 수 있는 결과
- 외부에서 확인할 수 있는 사실과 내부 처리에 대한 추론
- 현재 wake-surfer 코드가 실제로 처리하는 범위
- 후속 정책 문서에서 채택한 프로젝트 결정과 아직 남은 탐색 항목

이 카탈로그는 최종 기능 요구사항이 아니다. `미구현` 카드는 도입이 확정되었다는 뜻이 아니라 이후
시나리오·권한·오류·복구 정책에서 검토할 탐색 항목이라는 뜻이다.

## 참고 자료 해석 원칙

근거는 다음 네 등급으로 표시한다.

| 등급 | 의미 | 이 문서에서의 사용 원칙 |
| --- | --- | --- |
| `O — Observed` | 공개 UI에서 직접 관찰하고 기록한 행동 | 관찰 일시·화면·조건이 남아 있을 때만 사용한다. 현재 문서에는 독립된 UI 관찰 기록이 없으므로 임의로 `O`를 붙이지 않는다. |
| `D — Documented` | 공식 개발자 문서에 공개된 행동 | 해당 API 또는 앱 통합 경계에서 문서화된 범위만 주장한다. |
| `I — Inferred` | 공개 행동이나 현재 코드에서 추론한 의미 | 사실처럼 단정하지 않고 추론임을 명시한다. |
| `P — Project Decision` | 학습 목적에 맞게 wake-surfer가 채택한 동작 | 결정 이유·영향 시나리오·구현 상태를 함께 남긴다. 검토 중인 안에는 `P`를 붙이지 않는다. |

`현행`은 증거 등급이 아니라 저장소 코드·계약·테스트에서 확인한 구현 상태다. 아직 채택하지 않은
아이디어는 `미결정` 또는 `탐색 후보`로 표기한다.

Discord Gateway 문서는 Discord 앱이 사용하는 Gateway 연결의 heartbeat, dispatch sequence, session
resume 및 메시지 관련 이벤트를 설명한다. 이는 행동과 복구 정책을 탐색하는 `D` 근거로만 사용한다.

Slack Socket Mode 문서는 **Slack 앱용 Events API 전송 방식**이다. `envelope_id` ACK, 연결 갱신,
예정·비예정 종료를 설계 참고 자료로 사용할 수 있지만, Slack 자체 웹·데스크톱 클라이언트의 내부
프로토콜이라고 주장하지 않는다.

## 구현 상태 표기

| 상태 | 의미 |
| --- | --- |
| `현행` | 현재 저장소에서 카드의 핵심 흐름을 끝까지 확인할 수 있다. |
| `부분` | 일부 경로만 구현됐거나 단일 Gateway·channel 같은 명시적 제약이 있다. |
| `미구현` | 계약 또는 동작 경로가 현재 코드에 없다. |

## 현행 구현 확인 위치

행동 카드의 `현행` 설명은 주로 다음 코드와 공개 계약을 가리킨다.

- 연결·ticket·local fan-out: `apps/realtime-chat-gateway/src/app.ts`
- 브라우저 연결·재접속: `packages/realtime-chat-stream-messages-client/src/authenticated-realtime-session.ts`
- 조회·gap 복구: `packages/realtime-chat-stream-messages-client/src/session-model.ts`,
  `timeline-model.ts`
- optimistic UI: `apps/web/src/features/chat/chatRoomModel.ts`
- message 계약: `packages/realtime-chat-message-contracts`,
  `packages/realtime-chat-message-send-contracts`
- stream 조회 계약: `packages/realtime-chat-stream-messages-contracts`
- 현재 임시 권한 정책: `apps/realtime-chat-api/src/runtime/create-runtime-deps.ts`

---

## 연결

### BH-CON-001 — 일회성 ticket으로 연결하고 준비 완료를 확인한다

- 상태: `현행`
- 사전조건: API와 Gateway가 실행 중이고 client가 API의 임시 actor 인증 경계를 통과한다.
- 사용자 행동: 채팅 화면에 진입한다.
- 사용자 가시 결과: 연결과 초기 메시지 준비가 끝날 때까지 loading 상태가 보이고, 준비가 끝나면
  메시지를 조회하고 전송할 수 있다.
- 프로젝트 처리:
  1. client가 `POST /realtime-chat/gateway-tickets`로 새 ticket을 발급받는다.
  2. `gatewayUrl?ticket=...`로 WebSocket을 연다.
  3. Gateway가 API의 internal consume endpoint를 호출해 ticket을 일회성으로 소비한다.
  4. Gateway가 새 `sessionId`와 `connectionGeneration`을 만들고 `gateway.connected`를 보낸다.
  5. client는 유효한 `gateway.connected`를 받은 뒤에만 연결을 `ready`로 본다.
- 근거:
  - `현행`: ticket 원문은 client만 받고, actor는 ticket 소비 결과에서 Gateway session으로
    확정된다.
  - `P`: 재접속은 이전 transport session을 살리지 않고 새 ticket과 새 Gateway session을 사용하며,
    `gateway.connected` 검증을 Connection Ready의 기준으로 삼는다(`P-RS-001`, `P-RS-002`).
  - `I`: TCP/WebSocket upgrade 성공과 채팅 사용 준비 완료는 같은 시점이 아니다.
- 열린 항목: 장기 연결의 세션 만료 재검증과 명시적 로그인 session 연동은 별도 정책이 필요하다.

### BH-CON-002 — ticket 발급 또는 소비가 거절된다

- 상태: `부분`
- 사전조건: ticket 발급 요청이 거절되거나, 연결에 사용한 ticket이 없거나·만료됐거나·이미
  소비됐거나·할당된 Gateway와 맞지 않는다.
- 사용자 행동: 연결 또는 자동 재연결을 시도한다.
- 사용자 가시 결과:
  - ticket 발급 단계의 4xx 응답은 인증 실패 상태로 분류된다.
  - 발급된 ticket을 Gateway가 소비하는 단계의 거절은 현재 browser client에서 close code가
    보존되지 않아 구체적인 인증 실패가 아니라 재시도 가능한 socket 종료로 보일 수 있다.
  - 두 경로 모두 ticket 실패의 세부 원인은 사용자에게 노출하지 않는다.
- 프로젝트 처리:
  - ticket issuer는 API의 non-5xx 발급 거절을 `ticket_rejected`로 만들고, room model은 이를
    `authentication_failure`로 매핑한다.
  - ticket이 없거나 consume domain rejection이면 Gateway가 WebSocket을 `4401`로 닫는다.
  - ticket service 장애는 `1011` 종료로 처리한다.
  - `BrowserRealtimeEventSocket`은 현재 close code와 reason을 버리고 `socket_closed`만 전달한다.
- 근거:
  - `현행`: 부재·만료·재사용·Gateway 불일치를 ticket consume 외부에서는
    `invalid_or_expired`로 접는다.
  - `현행`: client의 정확한 `authentication_failure` 매핑은 ticket 발급 거절 경로에만
    존재한다.
  - `I`: 공격자에게 ticket 유효성의 세부 차이를 노출하지 않으려는 경계로 해석할 수 있다.
- 열린 항목: 안전하게 정규화한 close 분류를 client까지 보존할지, 명시적 rejection control
  event를 둘지, 재로그인 유도와 자동 재시도의 경계를 어디에 둘지 결정해야 한다.

### BH-CON-003 — 연결이 끊기면 새 ticket으로 재접속하고 메시지를 동기화한다

- 상태: `부분`
- 사전조건: 한 번 `ready`였던 WebSocket 연결이 명시적 logout 이외의 이유로 닫힌다.
- 사용자 행동: 별도 조작 없이 기다리거나, 실패 UI에서 복구 재시도를 선택한다.
- 사용자 가시 결과: 연결 실패 안내 또는 “누락된 메시지를 복구 중” 상태가 보인 뒤 다시 최신
  timeline을 볼 수 있다.
- 프로젝트 처리:
  - client는 기존 `sessionId`를 resume하지 않고 새 ticket과 새 Gateway session을 만든다.
  - 재접속마다 새 `connectionGeneration`을 받고 channel join과 stream sync를 다시 수행한다.
  - 재시도 delay는 250ms에서 시작해 최대 4초까지 증가하며 즉시 재시도 횟수에 상한이 있다.
  - cursor는 현재 브라우저 document 생명주기의 메모리에만 남는다. 새로고침하면 latest 조회부터
    다시 시작한다.
- 근거:
  - `현행`: 새 연결 generation마다 recovery를 한 번 queue하고 `afterSequence` 복구를 수행한다.
  - `P`: Resume은 transport session 재사용이 아니라 새 session에서 대화 재구독과 cursor catch-up으로
    상태를 복구하는 의미다(`P-RS-001`, `P-RS-003`).
  - `D — Discord 참고`: 공개 Gateway 문서는 session 정보와 마지막 dispatch sequence를 이용하는
    resume/replay 방식을 설명한다.
  - `I`: wake-surfer의 현재 동작은 session resume이 아니라 **reconnect 후 DB message sync**다.
- 열린 항목: browser reload를 넘는 cursor 저장과 Conversation fact의 replay 보존 범위는 미결정이다.

### BH-CON-004 — heartbeat로 zombie 연결을 탐지한다

- 상태: `미구현`
- 사전조건: 소켓이 겉으로는 열려 있지만 실제 양방향 통신이 불가능할 수 있다.
- 사용자 행동: 직접 행동하지 않는다.
- 사용자 가시 결과: 탐색 후보에서는 무한 loading 대신 연결 끊김과 복구 상태가 드러나야 한다.
- 프로젝트 처리: 현재 application heartbeat, heartbeat ACK, zombie timeout은 없다.
- 근거:
  - `D — Discord 참고`: Discord Gateway는 heartbeat interval과 heartbeat ACK 부재 시 reconnect
    동작을 공개한다.
  - `D — Slack Socket Mode 참고`: Socket Mode는 연결 종료와 갱신이 정상적으로 발생할 수 있음을
    앱 개발자에게 안내한다.
  - `미결정`: heartbeat 도입 여부, WebSocket ping/pong 사용 여부, timeout 소유자는 채택된 프로젝트
    결정이 아니다.
- 열린 항목: heartbeat 주체, interval, ACK 의미, background tab 영향, timeout 후 resume 가능 여부.

---

## 대화 접근과 구독

### BH-SUB-001 — channel 화면에 진입해 실시간 fan-out 대상으로 등록된다

- 상태: `부분`
- 사전조건: 인증된 Gateway 연결이 `ready`이고 channel ID가 비어 있지 않다.
- 사용자 행동: `/rooms/:channelId` 화면에 진입한다.
- 사용자 가시 결과: 같은 Gateway의 동일 channel 구독자가 보낸 새 메시지가 화면에 나타난다.
- 프로젝트 처리:
  - client는 connection generation마다 `chat.channel.join { channelId }`를 한 번 보낸다.
  - Gateway는 channel ID를 local session의 `Set`에 넣는다.
  - join 성공 ACK, join rejection payload, 권한 조회는 없다.
- 근거:
  - `현행`: join은 현재 fan-out routing 등록이다.
  - `P`: 구독은 connection별 routing 상태이며 view·subscribe capability 확인 뒤 활성화하고,
    Connection Ready와 Conversation Live를 분리한다(`SC-CON-004`, `P-RS-002`).
  - `I`: 이름이 join이어도 channel membership 가입이나 read 권한 승인을 뜻하지 않는다.
- 열린 항목: `conversation:subscribe` 권한, 성공 ACK, 중복 join 의미, server-side subscription
  generation을 정의해야 한다.

### BH-SUB-002 — channel을 나가거나 접근 권한이 회수되면 구독이 끝난다

- 상태: `미구현`
- 사전조건: 연결이 channel을 구독 중이다.
- 사용자 행동: 다른 화면으로 이동하거나 logout한다. 또는 외부 membership context가 접근 권한을
  회수한다.
- 사용자 가시 결과: 채택된 목표 행동은 이후 해당 channel의 새 메시지가 더 이상 보이지 않고, 권한
  회수 이유가 필요한 수준으로 안내되는 것이다.
- 프로젝트 처리:
  - 현재 `chat.channel.leave` 또는 unsubscribe ACK가 없다.
  - channel Set은 WebSocket session이 닫힐 때 사라진다.
  - React route 이탈만으로 Gateway 구독을 제거하는 wire 명령은 없다.
- 근거:
  - `현행`: 구독 해제는 connection 종료에만 묶여 있다.
  - `P`: 명시적 leave 또는 view 권한 회수 시 해당 Conversation 구독을 끝내며, 접근 회수는
    `ConversationAccessRevoked`로 처리한다(`SC-CON-007`, `SC-AUTH-002`, `P-RS-002` 상태 머신).
  - `I`: 권한 회수 후 stale local subscription이 남으면 실시간 노출 경계가 불명확해진다.
- 열린 항목: user-initiated unsubscribe의 구체적 wire 이름과 ACK, 접근 회수 뒤 기존 history의
  보존·제거 기준.

---

## 메시지 작성과 수신

### BH-MSG-001 — text message를 optimistic하게 전송하고 서버 결과로 확정한다

- 상태: `현행`
- 사전조건: 연결이 `ready`이고 현재 channel이 local session에 join돼 있다.
- 사용자 행동: 공백이 아닌 text를 입력하고 전송한다.
- 사용자 가시 결과:
  - 전송 직후 자신의 화면에 `pending` message가 나타난다.
  - API 저장 성공 응답이 오면 canonical message로 바뀌고 UI 상태는 `sent`가 된다.
  - 거절 또는 연결 오류이면 `failed`가 되고 재시도할 수 있다.
- 프로젝트 처리:
  - client는 UUID `clientMessageId`와 `sentAtClient`를 생성한다.
  - wire content는 `{ type: "text", text }`이며 최대 8,192 UTF-8 byte다.
  - API는 stream sequence를 발급하고 저장한 뒤 `chat.message.accepted` 결과를 돌려준다.
  - accepted는 모든 recipient가 message를 받았다는 delivery ACK가 아니다.
- 근거:
  - `현행`: web model의 상태는 `pending | sent | failed`다.
  - `현행`: `clientMessageId`는 저장 멱등성 key이고 `messageId`는 저장 후 생기는 canonical ID다.
  - `P`: `chat.message.accepted`는 recipient delivery가 아니라 Commit ACK이며, canonical identity는
    ACK와 live event의 도착 순서와 무관하게 병합한다(`P-ACK-001`, `P-ORD-004`).
  - `I`: 현재 UI의 `sent`는 “서버 저장 결과를 timeline에 반영함”에 가깝고 recipient delivery를
    증명하지 않는다.
- 열린 항목: command accepted와 canonical timeline 반영을 UI에서 별도 상태로 보일지는 미결정이다.

### BH-MSG-002 — 다른 구독자가 새 channel message를 수신한다

- 상태: `부분`
- 사전조건: 송신자와 수신자가 같은 Gateway 인스턴스의 같은 channel Set에 등록돼 있다.
- 사용자 행동: 한 사용자가 message를 전송한다.
- 사용자 가시 결과: 다른 사용자의 화면에 `chat.message.created`의 canonical message가 나타난다.
- 프로젝트 처리:
  - API accepted를 받은 Gateway가 자기 local ready session만 순회해 fan-out한다.
  - 송신자 session도 같은 channel을 구독했으면 `accepted`와 `created`를 모두 받을 수 있다.
  - timeline은 `messageId`와 `sequence`로 중복을 제거한다.
- 근거:
  - `현행`: fan-out 범위는 단일 Gateway의 local session이다.
  - `I`: API 응답과 socket push 사이 장애가 발생하면 저장된 message와 사용자 화면이 일시적으로
    달라질 수 있다.
- 열린 항목: 다중 Gateway fan-out, recipient 계산, broker/outbox는 현재 구현이 아니며 별도 결정이다.

### BH-MSG-003 — ACK 유실 후 같은 clientMessageId로 재시도한다

- 상태: `현행`
- 사전조건: 최초 요청이 저장됐지만 client가 accepted를 받지 못했거나 pending message가 실패로
  전환됐다.
- 사용자 행동: 실패한 message의 재시도를 선택한다.
- 사용자 가시 결과: 새 message가 하나 더 생기지 않고 기존 canonical message로 수렴한다.
- 프로젝트 처리:
  - retry는 최초 값과 같은 `clientMessageId`, text, `sentAtClient`를 사용한다.
  - DB unique key는 `senderActorId + streamId + clientMessageId`다.
  - API는 기존 message를 accepted로 반환한다.
  - 현재 Gateway는 duplicate accepted도 local `chat.message.created`로 다시 fan-out할 수 있으며
    client timeline이 중복을 제거한다.
- 근거:
  - `현행`: 저장 중복은 방지되지만 wire event 중복 가능성은 남아 있다.
  - `P`: ACK 유실은 `UNKNOWN_COMMIT`으로 분류하고 같은 `clientMessageId`와 같은 payload로 재시도하며,
    live 중복은 canonical identity로 한 번만 적용한다(`P-ACK-002`, `P-IDEM-002`, `P-IDEM-003`).
  - `I`: exactly-once delivery가 아니라 idempotent storage와 client dedup으로 수렴하는 모델이다.
- 열린 항목: duplicate 결과에 `duplicate` 표식을 줄지, delivery를 재발행할지 결정해야 한다.

### BH-MSG-004 — 처음 channel에 들어오면 최근 message와 live event를 충돌 없이 합친다

- 상태: `현행`
- 사전조건: 해당 actor/channel의 저장된 delivery cursor가 없다.
- 사용자 행동: channel 화면을 처음 연다.
- 사용자 가시 결과: 최근 message가 표시되고, 조회 중 도착한 새 message도 누락이나 중복 없이 이어진다.
- 프로젝트 처리:
  - WebSocket ready와 channel join 이후 latest HTTP query를 수행한다.
  - latest는 현재 stream head인 `throughSequence`까지 최대 5개를 반환한다.
  - latest 적용 전 live message는 sequence buffer에 둔다.
  - latest 적용 후 cursor 이하 중복을 버리고 바로 다음 sequence부터 buffer를 비운다.
- 근거:
  - `현행`: 이력 응답의 watermark와 live buffer를 결합하는 방식이다.
  - `P`: 초기 Conversation 로드는 subscribe, live buffer, authoritative baseline, gap recovery 순으로
    병합한다(`P-INIT-001`, `P-INIT-002`).
  - `I`: 참고 정책 분류로는 “이력 응답에 동기화 기준점을 포함하는 방식”에 가깝다.
- 열린 항목: 최초 화면에서 5개가 충분한지, 초기 history와 subscription 권한을 어떤 순서로 확정할지.

### BH-MSG-005 — 사용자가 더 오래된 message를 요청한다

- 상태: `현행`
- 사전조건: latest 또는 이전 page가 `hasMoreBefore: true`를 반환했다.
- 사용자 행동: “이전 메시지 불러오기”를 누른다.
- 사용자 가시 결과: 현재 timeline 앞쪽에 더 오래된 message가 sequence 순서대로 추가된다. 실패하면
  같은 버튼으로 재시도할 수 있다.
- 프로젝트 처리:
  - `beforeSequence`는 exclusive cursor다.
  - page limit 기본값은 50, 최대값은 100이다.
  - 응답 message는 연속 오름차순이며 같은 canonical channel stream이어야 한다.
- 근거:
  - `현행`: `GET /realtime-chat/channels/:channelId/messages/older`.
  - `P`: 과거 page 조회에는 현재 대화 view와 별도의 `history:read` capability를 검사하며, Full Sync의
    latest baseline과 older pagination을 분리한다(`05-actor-role-permission-model.md`,
    `P-SYNC-002`, `SC-MSG-011`, `FS-SYNC-007`).
- 열린 항목: scroll anchor 유지, 자동 pagination, history 보존 기간은 이후 UI/정책 단계에서 다룬다.

### BH-MSG-006 — 작성자가 자신의 message를 수정한다

- 상태: `미구현`
- 사전조건: 대상 message가 존재하고 작성자에게 수정 capability가 있다고 가정한다.
- 사용자 행동: message를 수정하고 저장한다.
- 사용자 가시 결과: 채택된 목표 행동은 수정 중/성공/충돌 상태와 수정된 내용이 같은 대화의 다른 client에도
  반영되는 것이다.
- 프로젝트 처리: edit command, revision/version, `MessageEdited` event, conflict 계약이 현재 없다.
- 근거:
  - `D — Discord 참고`: 공개 Gateway event 목록은 message update를 별도 dispatch로 분류한다.
  - `P`: 수정 요청은 `EditMessage` command, 성공 사실은 `MessageEdited`로 분리하고 소유권과 version을
    검사한다(`SC-MSG-004`).
  - `I`: offline replay를 지원하려면 단순 최신 text뿐 아니라 edit 순서 또는 revision 기준이 필요하다.
- 열린 항목: 수정 가능 시간, 소유권, optimistic concurrency, edit history, offline edit 재생.

### BH-MSG-007 — 작성자 또는 moderator가 message를 삭제한다

- 상태: `미구현`
- 사전조건: 대상 message가 존재하고 actor가 자기 message 삭제 또는 관리 삭제 capability를 가진다고
  가정한다.
- 사용자 행동: 삭제를 실행한다.
- 사용자 가시 결과: 채택된 목표 행동은 message가 삭제 표시로 바뀌고 다른 client에도 동일하게 반영되는
  것이다.
- 프로젝트 처리: delete command, tombstone, `MessageDeleted` event, moderator 정책이 현재 없다.
- 근거:
  - `D — Discord 참고`: 공개 Gateway event 목록은 message delete를 별도 dispatch로 분류한다.
  - `P`: 자기 삭제와 관리 삭제를 서로 다른 capability로 다루며, 관리 삭제는 수행 actor를 감사 가능한
    사실로 남긴다(`05-actor-role-permission-model.md`, `SC-MSG-005`, `SC-MSG-006`).
  - `I`: 누락 복구에서 삭제를 재현하려면 tombstone 또는 재생 가능한 삭제 사실이 필요하다.
- 열린 항목: hard/soft delete, 삭제 후 edit 충돌, 감사 정보, history 응답 표현.

### BH-THR-001 — 특정 message에 thread reply를 작성한다

- 상태: `미구현`
- 사전조건: root message와 대화 접근 권한이 있다고 가정한다.
- 사용자 행동: reply/thread 화면을 열고 text를 전송한다.
- 사용자 가시 결과: 채택된 목표 행동은 root와 연결된 reply가 보이고 구독 중인 participant에게
  갱신되는 것이다.
- 프로젝트 처리:
  - 공통 `MessageTarget`에는 `thread` variant가 있다.
  - 현재 Gateway는 non-channel send를 `write_forbidden`으로 거절하고 API 임시 정책도 thread 쓰기를
    거절한다.
- 근거:
  - `D — Discord 참고`: 공개 Gateway 문서는 thread 관련 event를 별도 범주로 제공한다.
  - `현행`: `thread` target variant만 있고 end-to-end 행동은 없다.
  - `P`: thread 메시지는 thread별 ordering을 갖는 stream에 기록하고 parent의 reply summary를
    갱신한다(`SC-MSG-008`, `FS-MSG-015`).
- 열린 항목: thread stream ID 형식, root 삭제 뒤 동작, thread별 read cursor의 UI 표현.

### BH-REA-001 — message에 emoji reaction을 추가하거나 제거한다

- 상태: `미구현`
- 사전조건: message 조회 권한과 reaction capability가 있다고 가정한다.
- 사용자 행동: emoji reaction을 선택하거나 자신의 reaction을 취소한다.
- 사용자 가시 결과: 채택된 목표 행동은 reaction 집계와 자신의 선택 상태가 여러 client에서 수렴하는
  것이다.
- 프로젝트 처리: reaction command, event, 저장 모델, dedup key가 현재 없다.
- 근거:
  - `D — Discord 참고`: 공개 Gateway event 목록은 reaction add/remove를 별도 dispatch로 제공한다.
  - `P`: `AddReaction`/`RemoveReaction` command와 `ReactionAdded`/`ReactionRemoved` fact를
    분리하고 actor+message+emoji를 멱등 기준으로 삼는다(`SC-MSG-009`, `FS-MSG-016`).
  - `I`: 동일 actor/message/emoji 조합의 반복 요청에는 별도 idempotency 기준이 필요하다.
- 열린 항목: custom emoji, count projection, 권한 회수, offline replay.

### BH-MEN-001 — 사용자 또는 그룹을 멘션한다

- 상태: `미구현`
- 사전조건: actor가 message 작성 권한을 가지며, 사용자 멘션 대상은 접근 가능한 범위에 있고 그룹
  멘션에는 별도 broadcast capability가 있다고 가정한다.
- 사용자 행동: 사용자 또는 그룹 멘션을 포함한 message를 작성해 전송한다.
- 사용자 가시 결과: 채택된 목표 행동은 검증된 멘션이 message 안에서 구분되어 보이는 것이다. 멘션에
  따른 실제 알림 전달은 Chat 경계가 보장하지 않는다.
- 프로젝트 처리:
  - 현행 text content에는 구조화된 mention target, range, group을 나타내는 계약과 parsing 흐름이
    없다.
  - Chat은 text와 구조화된 mention 대상을 함께 검증하고, 접근할 수 없는 actor ID의 위조와 권한 없는
    broadcast를 거절한다.
  - 사용자 멘션은 `mention:user`, 그룹 broadcast는 `mention:broadcast` capability를 사용한다.
  - 성공하면 `MessageCreated`와 파생 `UserMentioned` 사실을 만들며, 알림 결정·전달은 외부 시스템
    책임이다.
- 근거:
  - `P`: 구조화 mention 대상을 검증하고 `mention:user`/`mention:broadcast`를 집행하며,
    `UserMentioned`를 message 생성에서 파생하는 흐름을 채택했다(`SC-MSG-010`).
  - `I`: 표시 text만 `@name`으로 parsing하면 이름 변경, escaping, 동일 표시 이름, 임의 actor ID
    삽입을 안정적으로 구분하기 어렵다.
- 열린 항목: client와 server 중 parsing 소유자, text range와 target ID의 wire contract, text와
  구조화 target 불일치 처리, 그룹 확장 시점, 중복 mention, edit 시 파생 사실의 정정 방식.

---

## 임시 상태와 읽음 상태

### BH-EPH-001 — 입력 중 상태를 게시하고 만료한다

- 상태: `미구현`
- 사전조건: 대화가 열려 있고 actor가 typing publish 권한을 가진다고 가정한다.
- 사용자 행동: composer에 입력을 시작하거나 멈춘다.
- 사용자 가시 결과: 채택된 목표 행동은 다른 participant에게 일시적인 typing 표시가 나타났다가
  timeout으로 사라지는 것이다.
- 프로젝트 처리: typing event, TTL, rate limit, recipient 범위가 현재 없다.
- 근거:
  - `D — Discord 참고`: typing start가 공개 Gateway event 범주에 포함된다.
  - `P`: typing은 message history와 분리하고 저장·replay하지 않는 TTL 기반 ephemeral event로
    처리한다(`SC-EPH-001`, `SC-EPH-002`, `FS-EPH-001`, `FS-EPH-002`).
  - `I`: 최신 상태만 의미가 있으므로 일반적으로 message처럼 replay하지 않는 편이 자연스럽다.
- 열린 항목: debounce/TTL, reconnect 후 상태, privacy.

### BH-EPH-002 — 온라인·presence 상태를 반영한다

- 상태: `미구현`
- 사전조건: actor가 하나 이상의 client runtime으로 연결할 수 있고, 다른 participant가
  `conversation:view`를 가진 대화나 허용 범위에 있다고 가정한다.
- 사용자 행동: 접속·종료하거나 app을 background로 보내는 등 presence에 영향을 줄 수 있는 행동을
  한다. 명시적인 상태 선택을 제공할지는 미결정이다.
- 사용자 가시 결과: 탐색 대상은 허용된 상대에게 온라인 상태 변화를 일시적으로 보여 주는 것이다.
  구체적인 상태 종류와 공개 범위는 아직 채택하지 않았다.
- 프로젝트 처리:
  - 현재 presence command, `PresenceChanged` event, TTL, projection, 저장 모델은 없다.
  - 채택된 범위에서는 `PresenceChanged`를 message history·message sequence·message replay와 분리된
    ephemeral event 범주로 다룬다.
  - 별도의 latest-state 저장이나 reconnect snapshot을 둘지는 결정하지 않았다.
- 근거:
  - `D — Discord 참고`: 공식 Gateway Events 문서는 앱 Gateway의 Presence Update event를 공개한다.
    이는 event 분류 참고일 뿐 Discord client UI나 내부 처리의 증거가 아니다.
  - `P`: presence 변화는 `PresenceChanged` ephemeral 범주로 분류하고 message replay에서
    제외한다(`SC-EPH-003`).
- 열린 항목: 공개 대상과 privacy, online/away/offline 상태 집합, heartbeat와 presence의 관계, TTL,
  latest-state 저장 여부, reconnect snapshot.

### BH-READ-001 — 사용자가 읽은 위치와 unread 상태를 갱신한다

- 상태: `미구현`
- 사전조건: actor가 conversation을 읽을 수 있다고 가정한다.
- 사용자 행동: timeline을 특정 위치까지 본다.
- 사용자 가시 결과: 채택된 목표 행동은 자신의 unread 표시가 줄거나 사라지는 것이다.
- 프로젝트 처리:
  - domain read cursor, unread projection, `AdvanceReadCursor` command는 현재 없다.
  - 현재 `deliverySyncCursor`는 client가 연속 반영한 message 위치일 뿐, 사용자가 실제로 읽은 위치가
    아니다.
- 근거:
  - `현행`: delivery 복구 cursor만 존재한다.
  - `P`: delivery sync cursor와 actor+Conversation 단위 read cursor를 분리하고, background
    delivery만으로 read cursor를 전진시키지 않는다(`SC-READ-001`, `FS-READ-001`).
  - `I`: delivery cursor를 read cursor로 재사용하면 background tab에서도 읽음이 과도하게 전진할 수
    있다.
- 열린 항목: actor 단위 cursor의 영속, thread unread, 권한 상실 시 처리.

---

## 권한

### BH-AUTH-001 — 연결 중 conversation 권한이 회수된다

- 상태: `미구현`
- 사전조건: actor가 연결과 channel 구독을 유지하는 동안 외부 membership/role 상태가 바뀐다.
- 사용자 행동: 권한 회수 뒤 기존 화면에서 조회·전송을 계속 시도한다.
- 사용자 가시 결과: 채택된 목표 행동은 새 명령이 거절되고 더 이상 새 message가 노출되지 않으며,
  필요하면 channel 화면에서 이탈하는 것이다.
- 프로젝트 처리:
  - 현재 channel read는 모두 허용되고 channel write도 임시로 모두 허용된다.
  - Gateway join Set을 권한 변경 event로 제거하는 흐름은 없다.
- 근거:
  - `현행`: 실제 membership provider가 아직 조립되지 않았다.
  - `P`: view 권한이 회수되면 `ConversationAccessRevoked` 뒤 해당 구독·화면·buffer를 제거하고 다른
    Conversation 연결은 유지할 수 있다(`05-actor-role-permission-model.md`, `SC-AUTH-002`,
    `FS-SUB-003`). write만 회수되면 구독을 유지하고 새 mutation을 거절한다(`SC-AUTH-001`,
    `FS-AUTH-001`).
  - `I`: command 시점 권한과 이미 열린 subscription의 fan-out 권한은 별도 검사 지점이다.
- 열린 항목: 즉시 unsubscribe, 기존 message 제거.

---

## 누락·중복·순서 복구

### BH-SYNC-001 — live message gap을 감지하고 afterSequence로 복구한다

- 상태: `부분`
- 사전조건: 저장된 `deliverySyncCursor`보다 큰 message가 불연속 sequence로 도착하거나 새 connection
  generation이 시작된다.
- 사용자 행동: 일반적으로 직접 행동하지 않는다. retryable failure가 남으면 복구 재시도를 선택할 수
  있다.
- 사용자 가시 결과: 복구 중 안내가 보일 수 있고, 완료되면 누락 message가 sequence 순서로 timeline에
  합쳐진다.
- 프로젝트 처리:
  - 다음 sequence보다 큰 live message는 buffer한다.
  - 현행 Client는 새 `connectionGeneration` bootstrap에서 sync-after를 시작하지만, 열린 연결에서
    live gap을 buffer한 사실만으로 새 catch-up을 시작하지는 않는다.
  - `P`: live gap 감지 자체도 해당 Conversation의 catch-up trigger로 사용한다.
  - `chat.stream.sync`는 `requestId`, `channelId`, exclusive `afterSequence`, 선택적 고정
    `throughSequence`, `limit`를 보낸다.
  - response는 연속 message, `nextAfterSequence`, `hasMoreAfter`를 반환한다.
  - 첫 page의 `throughSequence`를 복구 종료까지 고정한다.
  - 중복 message는 `messageId`와 sequence identity로 제거한다.
- 근거:
  - `현행`: DB message stream 기반 sync-after, gap buffer, 새 generation bootstrap이 구현돼 있다.
    live gap 자체의 catch-up trigger는 없다.
  - `P`: message는 Conversation stream 안에서만 정렬하며 gap은 buffer를 유지한 채 고정 watermark까지
    catch-up하고, `invalid_cursor`는 해당 Conversation만 Full Sync로 전환한다(`P-ORD-001`,
    `P-ORD-003`, `P-SYNC-001`).
  - `D — Discord 참고`: Discord Gateway는 dispatch sequence와 session resume replay를 공개한다.
  - `I`: 두 방식 모두 sequence를 사용하지만 wake-surfer의 현재 sync는 Gateway event replay가 아니라
    저장 message query다.
- 열린 항목: edit/delete/reaction까지 생겼을 때 message sequence만으로 상태를 복원할 수 있는지,
  replay retention과 full sync 조건.

## 다음 문서로 넘길 항목

이 카탈로그의 행동은 이후 문서에서 다음처럼 구체화한다.

- 용어와 상태 의미: `04-glossary-and-state-machines.md`
- actor·role·capability: `05-actor-role-permission-model.md`
- 정상 흐름: `06-core-scenarios.md`
- 실패 지점과 복구: `07-failure-scenarios.md`
- command/domain/control/ephemeral 분류: `08-command-event-catalog.md`
- reconnect/resume/sync 선택: `10-reconnect-resume-sync-policy.md`

## 공식 참고 자료

- [Discord Gateway](https://docs.discord.com/developers/events/gateway)
- [Discord Gateway Events](https://docs.discord.com/developers/events/gateway-events)
- [Slack Developer Docs — Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
