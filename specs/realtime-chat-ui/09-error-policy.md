# 09. 실시간 문자 채팅 오류 분류·처리 정책

## 1. 문서 목적

이 문서는 현재 API와 WebSocket Gateway가 실제로 노출하는 오류를 정리하고, 이 문서 세트가 채택한
정규화 정책을 정의한다. `현행`과 `P(Project Decision)`를 의도적으로 분리한다. `P`는 선행 작업에
적용하는 결정이지만 현재 구현 또는 wire가 이미 이를 충족한다는 뜻은 아니며, 최종 기능 요구사항이나
비기능 요구사항으로 확정하는 문서도 아니다. 아직 결정하지 않은 사항은 `미결정(Open)`으로만 표시한다.

이 문서에서 사용하는 결과 종류는 다음과 같다.

| 결과 | 의미 |
| --- | --- |
| accepted | 명령이 기준 상태에 반영된 성공 결과 |
| rejected | 명령 형식은 처리할 수 있지만 도메인·권한·대상 조건 때문에 반영하지 않은 결과 |
| failed | 의존성·timeout·내부 오류 때문에 결과를 확정해 전달하지 못한 상태 |
| close | 현재 connection을 계속 신뢰하거나 처리할 수 없어 WebSocket을 종료한 결과 |

`failed`는 “저장되지 않았다”와 같지 않다. 특히 message send 도중 ACK 전에 연결이 닫히면 클라이언트가
commit 여부를 모르는 `unknown outcome`일 수 있다.

## 2. 현행 오류 표면

### 2.1 Message Send HTTP

`POST /internal/realtime-chat/messages`는 성공과 알려진 도메인 거절을 모두 HTTP 200으로 반환한다.
transport/API 오류만 4xx·5xx 공통 error envelope를 사용한다.
([API app.ts](../../apps/realtime-chat-api/src/app.ts#L224-L248))

| HTTP | body / code | 현행 의미 | Gateway·클라이언트 현행 행동 |
| --- | --- | --- | --- |
| `200` | `status: accepted`, `clientMessageId`, optional `commandId`, 저장된 `message` | DB message transaction 완료 | Gateway가 `chat.message.accepted`를 sender에게 보내고 local subscribers에 `chat.message.created` fan-out |
| `200` | `status: rejected`, reason `invalid_content`, `target_not_found`, `write_forbidden` | 알려진 명령 거절. 저장하지 않음 | Gateway가 `chat.message.rejected` 전송, 연결 유지 |
| `400` | `status: error`, `code: bad_request` | JSON/schema 위반, 서버 소유 필드 포함, 잘못된 Bearer 형식 | Gateway internal client에서는 non-2xx 예외가 되어 현재 message frame handler가 socket `1011` 종료 |
| `401` | `status: error`, `code: unauthenticated` | Gateway Bearer 누락·불일치, Gateway/actor context 누락 | Gateway internal client에서는 구조화 오류를 보존하지 않고 예외 처리 |
| `403` | `status: error`, `code: forbidden` | 허용되지 않은 Gateway identity | Gateway internal client에서는 구조화 오류를 보존하지 않고 예외 처리 |
| `503` | `status: error`, `code: internal_error` | message-send usecase 예외를 app이 service unavailable로 매핑 | `retryable` 필드는 없음. Gateway에서는 frame handler 예외가 되어 socket `1011` 종료 |

공통 HTTP error envelope는 현재 `{ status: "error", code, message }`뿐이다.
([api-contracts](../../packages/api-contracts/src/index.ts#L1-L7)) `commandId`, `clientMessageId`,
`retryable`, `closeConnection`은 포함하지 않는다. Message request schema가 text 형식과 크기를 먼저
검증하므로 일반 Gateway 경로의 잘못된 content는 API의 `rejected: invalid_content`보다 WebSocket
`1008` 또는 HTTP `400`에 먼저 도달할 수 있다.

### 2.2 Stream Messages HTTP와 WebSocket

Stream Messages는 message-send보다 오류 분리가 구체적이다.

| HTTP | HTTP code | WS 변환 | 현행 의미 |
| --- | --- | --- | --- |
| `400` | `bad_request` | `chat.stream.sync.rejected` + `requestId` | 잘못된 request ID, query/body/cursor 형식 |
| `401` | `unauthenticated` | Gateway credential 경계에서 internal 요청 실패 | actor/Gateway 인증 context 없음 |
| `403` | `forbidden` | Gateway credential 경계에서 internal 요청 실패 | Gateway identity 허용 안 됨 |
| `404` | `stream_unavailable` | `chat.stream.sync.rejected` | stream을 조회할 수 없음. 존재와 권한을 구분해 노출하지 않음 |
| `409` | `invalid_cursor` | `chat.stream.sync.rejected` | cursor가 현재 stream 상태와 맞지 않음 |
| `429` | `rate_limited`, `retryAfterMs`; HTTP `Retry-After` | `chat.stream.sync.rejected` + `retryAfterMs` | 일시적인 flow-control 거절 |
| `503` | `stream_messages_unavailable`, `retryable: true` | `chat.stream.sync.failed` | timeout, 의존성, integrity 또는 예상하지 못한 조회 실패 |

HTTP mapping 근거는
[routes.ts](../../apps/realtime-chat-api/src/features/stream-messages/routes.ts#L500-L564), WS 계약은
[errors.ts](../../packages/realtime-chat-stream-messages-contracts/src/errors.ts#L5-L74)에 있다.

Gateway는 sync frame이 유효하지 않아도 `requestId`를 안전하게 읽을 수 있으면
`chat.stream.sync.rejected(code=bad_request)`를 보내고 connection을 유지한다. `requestId`조차 복구할
수 없으면 `1008`, sync payload가 허용 크기를 넘으면 `1009`로 닫는다. 이는 현재 코드 안에 이미 있는
“correlation 가능 여부”에 따른 차이다.
([gateway-relay.ts](../../packages/realtime-chat-stream-messages-gateway/src/gateway-relay.ts#L150-L177))

### 2.3 WebSocket application 결과

| wire 결과 | correlation | connection | 현행 처리 |
| --- | --- | --- | --- |
| `gateway.not_ready` | 없음 | 유지 | 인증/ready 전 application frame에 응답 |
| `chat.message.accepted` | `clientMessageId`, optional `commandId` | 유지 | sender optimistic message를 저장 message와 조정 |
| `chat.message.rejected` | `clientMessageId`, optional `commandId` | 유지 | 현행 UI는 optimistic message를 `failed`로 표시 |
| `chat.stream.sync.rejected` | `requestId` | 유지 | domain/validation/rate-limit 결과로 처리 |
| `chat.stream.sync.failed` | `requestId` | 유지 | `stream_messages_unavailable`, `retryable: true` |

반면 message-send API timeout, non-JSON, non-2xx, response schema mismatch는 message 전용 failure event로
변환되지 않는다. 예외가 top-level frame handler까지 올라가 `1011`로 connection 전체를 닫는다.
([Gateway API client](../../apps/realtime-chat-gateway/src/runtime/gateway-api-client.ts#L122-L157),
[Gateway app.ts](../../apps/realtime-chat-gateway/src/app.ts#L134-L158))

### 2.4 현행 WebSocket close code

| code | 현재 발생 지점 | client가 현재 알 수 있는 의미 | correlation / 상태 |
| --- | --- | --- | --- |
| `1001` | Gateway 정상 shutdown | 서버가 연결 종료 중 | 개별 command correlation 없음. 새 연결 필요 여부 hint 없음 |
| `1003` | binary frame 수신 | text JSON만 지원 | 어떤 command인지 correlation하지 않고 종료 |
| `1008` | invalid JSON/wire type, unsupported event, invalid join/send frame, correlation 불가능한 invalid sync, stale/invalid sync session | protocol/policy 위반 | 일부 frame은 `type`이나 command ID가 있어도 현재 즉시 종료 |
| `1009` | sync payload 허용 크기 초과; WebSocket max payload 경계 | message/frame이 너무 큼 | command response 없이 종료 |
| `1011` | frame handler 예외, ticket service 예외, message-send internal HTTP 실패·timeout·schema mismatch | 예상하지 못한 server-side failure | 명령별 결과와 commit 여부를 전달하지 못함 |
| `4401` | ticket 누락 또는 ticket consume 거절 | Gateway 인증 불가 | ticket은 폐기 대상. logical session resume 정보 없음 |

`1001` 근거는
[close-servers.ts](../../apps/realtime-chat-gateway/src/runtime/close-servers.ts#L6-L24), 나머지 주요 close는
[Gateway app.ts](../../apps/realtime-chat-gateway/src/app.ts#L173-L311)에 있다. WebSocket upgrade 전에는
별도로 malformed URL `400`, 허용되지 않은 Origin `403`, path mismatch `404`, shutdown 중 `503` HTTP
거절이 존재한다.

### 2.5 현행 client 상태 변화

| 관찰 결과 | 현재 client 행동 |
| --- | --- |
| `chat.message.accepted` | optimistic entry를 제거하고 저장 message를 timeline에 적용 |
| `chat.message.rejected` | optimistic entry를 `failed`로 변경. reason별 사용자 행동은 분리하지 않음 |
| socket send 즉시 실패 | optimistic entry를 `failed`로 변경 |
| disconnect | 모든 `pending` message를 `failed`로 바꾸고 recovery를 `retryable_failure`로 변경 |
| `rate_limited` | 유효한 `retryAfterMs` 동안 해당 sync를 보류한 뒤 같은 cursor에서 재개 |
| `stream_unavailable` | recovery phase를 `stream_unavailable`로 변경 |
| `invalid_cursor` | recovery phase를 `invalid_cursor`로 변경. 자동 full sync는 없음 |
| retryable stream failure | recovery phase를 `retryable_failure`로 변경 |
| identity/cursor/protocol conflict | `protocol_failure`; 데이터를 임의로 덮어쓰지 않음 |

Message UI 근거는
[chatRoomModel.ts](../../apps/web/src/features/chat/chatRoomModel.ts#L155-L209)와
[chatRoomModel.ts](../../apps/web/src/features/chat/chatRoomModel.ts#L255-L300), stream recovery 근거는
[session-model.ts](../../packages/realtime-chat-stream-messages-client/src/session-model.ts#L113-L207)에 있다.

## 3. P 오류 category

다음 category는 기능별 오류 이름을 만들기 전에 적용하는 P 공통 분류다. 하나의 HTTP status나 close
code가 category를 완전히 결정하지는 않는다.

| category | 판정 의미 | 현재 예 / 추가 시나리오 예 |
| --- | --- | --- |
| Protocol | frame 또는 응답을 신뢰할 수 없어 protocol 진행이 불가능하거나 모순됨 | unknown event type, 잘못된 flat JSON, message identity conflict |
| Authentication | actor/session/service credential을 확정할 수 없음 | HTTP `unauthenticated`, WS `4401`, ticket 만료 |
| Authorization | actor는 확인됐지만 행동 capability가 없음 | `write_forbidden`, Gateway identity `forbidden`, channel 접근 거절 |
| Validation | 명령의 필드·값·크기가 계약을 만족하지 않음 | `bad_request`, `invalid_content`, oversized content |
| Not Found | 대상 resource를 현재 찾거나 공개할 수 없음 | `target_not_found`, `stream_unavailable` |
| Conflict | 현재 resource version/state와 명령 전제가 충돌함 | `invalid_cursor`, 삭제 후 수정, 동시 편집 충돌 |
| Duplicate | 이미 처리한 명령 또는 event를 다시 관찰함 | 동일 `clientMessageId`, 동일 messageId/sequence |
| Dependency | DB, API, limiter, broker 등 의존 경계가 결과를 제공하지 못함 | `stream_messages_unavailable`, message-send `503` |
| Flow Control | 처리량·in-flight·slow consumer를 제어하기 위한 일시 거절 | `rate_limited`, 동일 channel sync 중복 in-flight |
| Session | logical/transport session의 복구 전제가 맞지 않음 | `gateway.not_ready`, stale generation, 향후 resume token 무효 |
| Internal | 위 category로 안전하게 분류할 수 없는 서버 결함 | `internal_error`, WS `1011`의 일부 |

`Duplicate`는 반드시 실패일 필요가 없다. 현재 message-send는 같은
`(senderActorId, streamId, clientMessageId)`를 다시 받으면 기존 accepted result를 반환한다.

## 4. P 정규화 error record

첨부 선행안의 필드를 P 정규화 record로 사용하되, 현재 wire가 이 모양이라고 오해하지 않는다.

| 필드 | P 의미 | 현행 coverage |
| --- | --- | --- |
| `errorCode` | client 분기용 안정 code | HTTP의 `code`, message rejection `reason`, 일부 WS event `code`로 분산 |
| `category` | Protocol~Internal 공통 분류 | wire에 없음 |
| `message` | 사용자 또는 호출자가 읽을 수 있는 안전한 요약 | HTTP error에 있음; message rejected와 WS close는 별도 형태 |
| `commandId` | 실패한 command와의 correlation | message에서 optional; sync는 대신 `requestId`; malformed frame에는 없을 수 있음 |
| `retryable` | 같은 조건에서 자동 또는 수동 재시도가 허용되는지 | stream infrastructure failure에만 명시적; message `503`에는 없음 |
| `retryAfter` | 재시도 전에 기다릴 server hint | stream은 `retryAfterMs`와 HTTP `Retry-After`; 그 외 없음 |
| `closeConnection` | 이 오류가 connection 종료를 요구하는지 | 구조화 field 없음; close frame 자체로만 표현 |
| `resumeAllowed` | 같은 logical session resume를 시도할 수 있는지 | resume protocol 자체가 없음 |
| `fullSyncRequired` | 기존 cursor를 버리고 authoritative baseline이 필요한지 | field 없음; `invalid_cursor` 뒤 Conversation 단위 Full Sync 전환은 `P` |
| `userVisible` | 사용자에게 직접 보여 줄 오류인지 | wire에 없음; UI가 reason을 세분하지 않음 |
| `logLevel` | server 관측 시 적용할 severity | runtime logger 호출이 위치별로 결정 |

현재 correlation carrier는 message의 `clientMessageId`/optional `commandId`, stream의 `requestId`,
internal HTTP의 `x-request-id`, connection의 `sessionId`/`connectionGeneration`으로 서로 다르다.
P 정규화에서는 이 값들을 하나의 ID처럼 합치지 않고 correlation scope와 함께 기록한다.

## 5. P 기본 처리 원칙

다음은 선행 시나리오 전체에 적용하는 P이며 현재 구현 설명이 아니다.

1. **특정 명령 하나의 실패는 가능한 한 connection 전체를 닫지 않는다.** 인증된 session과 wire parser가
   다음 frame을 안전하게 처리할 수 있으면 correlation된 rejected/failed 결과를 보내고 연결을 유지한다.
2. 인증 불가, framing을 신뢰할 수 없는 protocol 위반, 허용 크기를 넘겨 안전한 parse가 불가능한 입력,
   connection/session 자체의 복구 불가능한 모순은 연결을 종료한다.
3. `retryable`은 “반드시 자동 재시도”가 아니다. client가 같은 명령을 그대로 반복해도 되는지,
   새로운 credential·cursor·state refresh가 필요한지를 함께 구분한다.
4. message send가 `unknown outcome`이면 새 message ID를 만들기보다 같은 `clientMessageId`와 동일 payload로
   기존 결과를 확인한다.
5. 사용자에게 보이는 문구와 server log의 상세 원인을 분리한다. client response와 close reason에는
   stack, SQL, 내부 URL, token, 전체 message content를 넣지 않는다.
6. 알 수 없는 내부 오류는 구체적인 내부 정보를 client에 노출하지 않고 correlation 값으로 server log와
   연결한다.

## 6. P correlation 가능 여부와 close 판단

| 입력/실패 상태 | correlation 가능성 | P 결과 | connection |
| --- | --- | --- | --- |
| 지원 event type이고 command/request ID를 읽을 수 있으나 field validation 실패 | 가능 | 해당 command `bad_request`/validation rejection | 유지 |
| 권한·대상·conflict·rate limit | 가능 | correlation된 rejected event | 유지 |
| API/DB timeout이지만 Gateway session과 wire writer는 정상 | 가능 | correlation된 retryable failed event | 유지 |
| JSON object와 event type은 읽히나 command ID가 없음 | 부분 가능 | `미결정(Open)`: event-type 수준 error와 반복 위반 close 기준 | `미결정(Open)` |
| JSON/framing 자체를 읽을 수 없고 안전한 correlation 불가 | 불가 | protocol close `1008` | 종료 |
| 지원하지 않는 binary frame | 불가 | `1003` | 종료 |
| 안전한 parse 전에 크기 제한 초과 | 불가 | `1009` | 종료 |
| ticket 없음·무효로 actor/session 확정 불가 | connection 수준 | `4401` | 종료 |
| 정상 server shutdown | connection 수준 | `1001` | 종료 |
| connection/session writer 자체가 신뢰 불가한 내부 결함 | 불가 | `1011` | 종료 |

이 P를 적용하면 현재 “message-send internal HTTP 실패 → 무조건 `1011`” 경로는 명령별 failure로
정규화해야 한다. 반대로 correlation할 수 없는 malformed frame까지 억지로 application error로
만들지는 않는다.

## 7. 오류별 client 행동

| 관찰 code/category | user state | retry / recovery | 연결 | 상태 |
| --- | --- | --- | --- | --- |
| message `accepted` | `sent` | 재시도 없음 | 유지 | 현행 |
| `invalid_content`, `bad_request` | 입력 실패 또는 client protocol 문제 | 동일 payload 자동 재시도 안 함; 수정 후 새 시도 | correlation 가능 시 유지 | `P` |
| `write_forbidden`, HTTP `forbidden` | 권한 거절 | 자동 재시도 안 함; optimistic state 되돌림 | 인증 session이 유효하면 유지 | `P` |
| `target_not_found`, `stream_unavailable` | 대상 접근 불가 | 같은 조건의 반복 중단; 대화 목록/접근 상태 refresh | 유지 | `P` |
| reply/thread parent 또는 reaction target conflict | 대상이 삭제됐거나 현재 상태와 명령 전제가 충돌 | 최신 tombstone/projection 반영; 동일 명령 자동 재시도 안 함 | 유지 | `P` |
| `invalid_cursor` (delivery sync/catch-up) | 현재 delivery cursor 사용 불가 | 같은 cursor 재시도 금지; 해당 Conversation의 authoritative baseline으로 Full Sync | 유지 | `P` |
| `invalid_cursor` (older history) | 과거 pagination cursor 사용 불가 | delivery cursor와 timeline은 유지하고 history pagination 경계만 다시 얻음 | 유지 | older 거절 현행, 복구 `P` |
| read cursor conflict (wire code `미결정`) | read marker 갱신 거절 | authoritative read cursor를 재조회하며 delivery state는 유지 | 유지 | `P` |
| duplicate message command | 최초 처리 결과 적용 | 같은 `clientMessageId`면 새 message 생성 안 함 | 유지 | 현행 |
| `rate_limited` | recovery/send 보류 | server hint 뒤 같은 안전 cursor/command를 재시도 | 유지 | stream sync 현행, 일반화 `P` |
| typing flow-control | typing 표시 갱신 보류 | 최신 상태로 coalesce하거나 drop; message command 상태는 바꾸지 않음 | 반복 악용 전에는 유지 | `P` |
| `stream_messages_unavailable` | 일시 복구 실패 | cursor 보존, 해당 conversation sync 재시도 | 유지 | 현행 |
| message-send `503` 또는 send 중 `1011` | commit 여부 불명 | 같은 `clientMessageId`·동일 payload로 결과 확인 | 현행은 close; 정규화 `P` |
| HTTP `unauthenticated`, WS `4401` | 인증 실패 | 같은 credential/ticket 반복 금지; 상위 인증 상태 확인 후 새 ticket | 종료 가능 | `P` |
| `gateway.not_ready` | connection 준비 중 | application command 중단, ready 또는 새 connection 판단 | 현행은 유지 | 현행 |
| `1001` | transport 종료 | 명시적 logout이 아니면 새 ticket/session 연결 | 종료 | `P` |
| `1003`, `1008`, `1009` | client/protocol 수정 필요 | 동일 frame의 blind retry·즉시 reconnect loop 금지 | 종료 | `P` |
| `1011` | server-side/unknown transport failure | 새 connection 후 cursor sync; pending send는 unknown outcome 처리 | 종료 | `P` |
| message identity/sequence conflict | local projection 신뢰 불가 | 임의 덮어쓰기 금지; 해당 conversation 복구 중단 | connection 유지 여부는 `미결정(Open)` | `P` |

사용자에게 표시할 최종 문구, 자동 재시도 횟수, delay 수치, 서비스 수준 목표는 이 표에서 정하지 않는다.

## 8. 재시도 가능 여부 요약

| 실패 | 같은 입력 즉시 재시도 | 바꿔야 할 것 | 중복 방지 기준 | 현행 / P |
| --- | --- | --- | --- | --- |
| message domain rejection | 아니오 | content, target 또는 권한 상태 | `clientMessageId` | 현행 거절; 행동 `P` |
| reply/thread/reaction target conflict | 아니오 | 최신 target/tombstone projection 조회 | parent 또는 actor+message+emoji identity | `P` |
| message ACK 유실·`1011` | 즉시 새 ID로 재전송하지 않음 | 같은 ID/payload로 결과 확인 | `(actorId, streamId, clientMessageId)` | 저장 멱등성 현행; 복구 `P` |
| stream `rate_limited` | 아니오 | `retryAfterMs` 경과 | `requestId`는 요청 correlation, cursor는 데이터 위치 | 현행 |
| stream infrastructure failure | 가능 | 기존 delivery cursor 보존 | `afterSequence`, fixed `throughSequence` | 현행 retryable 분류 |
| delivery sync의 `invalid_cursor` | 같은 cursor로는 아니오 | 해당 Conversation의 authoritative baseline 재조회 | 새 delivery baseline cursor | `P` |
| older history의 `invalid_cursor` | 같은 cursor로는 아니오 | 접근 상태와 history pagination 경계 재조회 | delivery cursor와 분리된 `beforeSequence` | 거절 현행, 복구 `P` |
| read cursor conflict | 같은 값 반복 아님 | authoritative actor+Conversation read cursor 재조회 | 단조 증가 read cursor | `P` |
| `stream_unavailable` | 같은 접근 상태에서는 아니오 | membership/대상 상태 확인 | conversation identity | `P` |
| `401`/`4401` | 같은 credential로는 아니오 | 인증 상태·새 ticket | one-time ticket | ticket 1회성 현행; 행동 `P` |
| `1001` | 기존 socket에는 불가 | 새 connection/session | 새 connection generation | `P` |
| `1003`/`1008`/`1009` | 아니오 | frame type/schema/size 수정 | 새 유효 command identity | `P` |
| dependency/internal failure | 오류별 | dependency 회복 또는 새 connection | command별 멱등 키 필요 | `P` |

## 9. 사용자 메시지와 server log 원인 분리

### 9.1 현행

- API의 5xx body는 `message send service unavailable`, `Stream Messages service unavailable`,
  `realtime chat API unavailable`처럼 내부 원인을 숨긴다.
- API app은 5xx를 error log에 남긴다. Stream Messages는 `requestId`, query, channel, error class와
  integrity metadata를 남기고 raw message content를 log context에 넣지 않는다.
- Gateway는 frame/ticket/API relay 예외를 server log에 기록하고 client에는 짧은 close reason 또는
  정형 event code만 보낸다.
- fan-out socket send 실패는 저장 결과를 뒤집지 않고 session/error context를 warn log에 남긴다.

### 9.2 P 분리 정책

| 대상 | client/user 노출 | server log | 노출하지 않을 값 |
| --- | --- | --- | --- |
| Validation | 안정 error code와 수정 가능한 field 범위 | schema issue category, command/request correlation | 전체 raw frame, 전체 message text |
| Authentication | credential이 유효하지 않다는 일반 문구 | auth boundary, Gateway/session/request ID, 실패 단계 | token, ticket 원문, secret header |
| Authorization/Not Found | 행동 또는 대화에 접근할 수 없다는 일반 문구 | actor·conversation 식별자와 capability 판정 결과 | 숨겨야 할 resource 존재 여부, role 내부 상세 |
| Dependency | 일시적으로 처리할 수 없다는 일반 문구와 명시적 retry hint가 있을 때만 hint | dependency 이름, timeout/error class, request ID, 내부 cause chain | SQL, 내부 URL credential, stack의 client 반환 |
| Internal/Protocol | 일반 protocol/internal code | error class·stack·connection generation·correlation·검증 단계 | source path/stack을 client close reason에 포함 |
| Message delivery | 저장 결과와 delivery 결과를 구분한 상태 | messageId/streamId/sequence, 실패 Gateway/session | 전체 content와 recipient 개인정보의 불필요한 복제 |

`message`는 client 분기 기준이 아니라 사람이 읽는 안전한 설명이며, 분기는 안정적인
`errorCode`/`reason`을 사용한다. server log는 원인 분석에 충분해야 하지만 데모 token, ticket, message
본문을 그대로 보존하는 수단으로 사용하지 않는다.

## 10. 미결정(Open)

다음은 오류 시나리오에서 추가로 결정할 질문이며 최종 FR/NFR가 아니다.

- Message Send에 `chat.message.failed`와 명시적 `retryable`을 추가할지
- command correlation이 없는 parseable frame을 connection 유지 오류로 처리할지
- 반복 protocol 위반을 단건 오류에서 close로 승격하는 기준을 둘지
- Full Sync snapshot의 정확한 범위·page 크기와 사용자가 과거 이력을 다시 요청하는 기준
- message identity/sequence conflict를 conversation 복구 중단만으로 격리할지 connection도 닫을지
- `1001`과 `1011` 뒤 자동 재연결 여부를 사용자 logout과 어떻게 구분할지
- dependency cause를 보존하면서 message content·credential을 log에서 배제하는 공통 formatter를 둘지
- 향후 resume이 생길 경우 각 오류의 `resumeAllowed` 의미를 어떻게 정의할지
