# Flow 04 메시지 전송 권한 거절 구현 계획

> **문서 상태: 이슈 작성용 구현 계획이며 현재 계약이 아니다.**
>
> 이 문서는 `flow-sequence-guide.md`의 Flow 4를 현재 코드와 메시지 전송 PR 위에서 어떻게 완성할지
> 검토한 사람용 `notes` 문서다. 에이전트 기본 문맥이나 소비자 계약 경로에 포함하지 않는다. 실제 구현에서
> 확정된 외부 계약과 소유자 규칙은 각 패키지의 `README.md`, `public-docs/`, `owner-docs/`에 별도로
> 반영한다.

## 1. 목적과 범위

채널에 메시지를 쓸 권한이 없는 사용자의 전송 요청을 API 도메인 결과로 거절하고, 다음 불변조건을
끝까지 보장한다.

- Gateway는 채널 권한을 추측하거나 최종 판단하지 않는다.
- API가 신뢰된 `actorId`와 권한 기준 상태를 사용해 최종 판단한다.
- 거절된 요청은 메시지를 저장하지 않고 stream sequence도 증가시키지 않는다.
- 거절된 요청으로 outbound delivery 이벤트를 만들거나 발행하지 않는다.
- 클라이언트는 `commandId`와 `clientMessageId`로 낙관적 메시지를 찾아 실패 상태로 바꿀 수 있다.
- 도메인 거절과 API timeout, 5xx, 잘못된 응답 같은 통신 장애를 구분한다.

이 계획의 중심은 채널 메시지 전송 본체를 다시 구현하는 것이 아니라, 메시지 전송 PR에 마련된 권한
포트를 실제 권한 기준 상태에 연결하고 거절 결과를 API와 Gateway 경계를 통해 보존하는 것이다.

## 2. 현재 상태

### 현재 작업 트리

- `apps/realtime-chat-api`는 gateway ticket 발급·소비 HTTP 경계만 조립한다.
- `apps/realtime-chat-gateway`는 ticket 인증과 로컬 WebSocket 세션만 소유한다. 메시지 envelope 해석,
  API relay, `chat.message.rejected` 전송은 아직 없다.
- 채널, 채널 멤버십, 역할, 보관 상태를 소유하는 package나 테이블은 현재 작업 트리에 없다.
- `apps/web/src/features/chat/contracts.ts`와 목 transport에는 일반적인 `MessageRejectedResponse`와 실패
  UI가 있지만, backend contracts가 합쳐지기 전의 임시 미러다.

### 채널 메시지 전송 PR 선행 구현

로컬 `feat/26-message-send` 브랜치의 PR 스냅샷에는 다음이 이미 있다.

- `packages/realtime-chat-message-send-contracts`
  - `SendMessageResponse`의 `accepted | rejected` 판별 합집합
  - 거절 사유 `invalid_content | target_not_found | write_forbidden`
- `packages/realtime-chat-message-send`
  - `MessageWriteAuthorizer` 포트
  - `authorizeWrite({ actorId, target, streamId })` 호출
  - `denied`를 `write_forbidden`으로 변환하는 유스케이스 분기
  - 권한 확인 뒤에만 append와 delivery publish를 수행하는 순서

따라서 Flow 4의 도메인 분기 뼈대는 PR에 포함돼 있다. 다만 다음은 아직 없다.

- 실제 채널 멤버십·상태를 읽는 `MessageWriteAuthorizer` 구현
- 권한 거절 전용 유스케이스 테스트
- 실제 PostgreSQL에서 메시지 미저장과 sequence 불변을 확인하는 통합 테스트
- API endpoint와 Gateway relay
- 클라이언트 WebSocket 거절 event 계약

또한 해당 브랜치는 현재 런타임 안전성 변경보다 오래된 `dev`를 기준으로 한다. 구현 이슈를 시작할 때
PR을 최신 `dev`에 병합 또는 재배치한 최종 파일과 계약을 다시 확인해야 하며, 브랜치 비교에서 보이는
현재 API·Gateway 앱 삭제를 메시지 기능의 의도로 해석하면 안 된다.

## 3. 선행 의존성

### 반드시 먼저 확인할 사항

1. 채널 메시지 전송 PR이 병합되고 아래 이름과 의미가 유지되는지 확인한다.
   - `MessageWriteAuthorizer`
   - `SendMessageResponse`
   - `write_forbidden`
   - `commandId`, `clientMessageId`
2. 실제 채널 쓰기 권한의 기준 상태 소유자를 정한다.
   - 채널 존재 여부
   - workspace/channel membership
   - 보관된 채널인지
   - 역할별 쓰기 제한이 있는지
3. 클라이언트의 주 전송 경로를 정한다.
   - 이 문서는 Flow 4 스케치에 맞춰 `Client -> Gateway WebSocket -> API HTTP`를 기본 가정한다.
   - 메시지 전송 PR의 notes는 직접 HTTP 전송도 열어 두고 있으므로, 직접 HTTP를 선택하면 Gateway relay
     단계는 범위에서 제외하고 동일한 도메인 결과 계약만 유지한다.
4. Gateway와 API 사이의 신뢰 경계를 정한다.
   - `actorId`는 클라이언트 payload에서 받지 않는다.
   - Gateway relay라면 ticket에서 확정해 세션에 저장한 `actorId`를 인증된 내부 요청 문맥으로 전달한다.
   - 직접 HTTP라면 API 인증 문맥에서 `actorId`를 확정한다.

### 권한 기준 상태가 아직 없을 때

인메모리 `allow all`, 환경 변수 allowlist, 임시 boolean을 운영 구현으로 넣지 않는다. 권한 원천이 다른
도메인 또는 서비스에 있다면 그 provider의 공개 계약을 먼저 만들고, realtime-chat은 그 계약의
consumer가 된다. 권한 원천이 이 저장소의 realtime-chat 소유라면 채널·멤버십 모델을 별도 이슈로 먼저
구현한다.

## 4. 책임 경계

| 책임 | 소유 위치 | 규칙 |
| --- | --- | --- |
| JSON, 크기, event type, 필수 correlation 필드 검증 | Gateway package | 도메인 권한을 판단하지 않는다. |
| 소켓에서 신뢰된 `actorId` 해석 | Gateway session | 클라이언트가 보낸 actor 값을 사용하지 않는다. |
| target을 stream으로 해석 | message-send package의 resolver | 권한 판단과 저장 전에 안정적인 stream을 정한다. |
| 채널 쓰기 권한 판단 | 권한 기준 상태 provider + API 측 adapter | Gateway와 web이 판단하지 않는다. |
| 거절 결과 생성 | message-send 유스케이스 | 공개 사유는 contracts에 정의된 값만 반환한다. |
| HTTP 요청·응답 변환 | API package/앱의 얇은 adapter | 도메인 거절과 인프라 실패를 분리한다. |
| WebSocket event 변환 | Gateway package | API의 거절을 의미 변경 없이 sender에게 relay한다. |
| 낙관적 메시지 실패 표시 | web chat model/transport | `clientMessageId`로 항목을 찾는다. |
| 메시지·sequence·delivery 불변조건 | message-send package | 거절 경로에서는 쓰기가 전혀 없어야 한다. |

권한 판단 코드는 `apps/realtime-chat-api/src/app.ts`에 직접 쌓지 않는다. 앱은 권한 provider, message-send
module, HTTP adapter를 조립하는 런타임 쉘로 유지한다. 권한 원천이 외부 provider라면 consumer는 해당
provider의 `README.md`와 `public-docs/*`만 읽고 `owner-docs/`, `notes/`에는 의존하지 않는다.

## 5. 예상 패키지와 파일

아래 경로는 메시지 전송 PR 병합 뒤의 실제 구조를 확인해 조정한다. 같은 책임의 기존 파일이 있으면 새
package나 병렬 계약을 만들지 않는다.

### 메시지 전송 계약과 유스케이스 보강

```txt
packages/realtime-chat-message-send-contracts/
  README.md
  src/index.ts
  test/message-send-request-body.test.ts

packages/realtime-chat-message-send/
  README.md
  src/message-send-module.ts
  src/usecases/send-message/send-message.usecase.ts
  test/message-send-usecase-invariants.test.ts
  test/message-send-postgres.integration.test.ts    # 저장소 통합 테스트 위치는 저장소 관례에 맞춤
```

기존 `MessageWriteAuthorizer`가 Flow 4에 충분하면 타입을 늘리지 않는다. 운영 관찰을 위해 세부 거절 원인이
필요할 때만 내부 결과를 다음처럼 확장하고, 외부에는 계속 `write_forbidden` 하나로 매핑한다.

```ts
type MessageWriteAuthorization =
  | { status: "allowed" }
  | {
      status: "denied";
      cause?: "not_member" | "archived" | "read_only";
    };
```

### 권한 adapter

권한 원천이 확정된 뒤 다음 둘 중 하나를 선택한다.

```txt
packages/<권한-provider>/public-docs/api.md
packages/<권한-provider>/public-docs/invariants.md
packages/<권한-provider>/src/...                     # provider가 채널 권한을 직접 소유하는 경우
```

또는

```txt
packages/realtime-chat-api/
  src/send-message/channel-write-authorizer.ts        # 외부 권한 계약을 message-send 포트로 번역
  test/channel-write-authorizer.test.ts
```

`packages/realtime-chat-api`가 메시지 전송 통합 PR에서 생기지 않는다면, 임의로 이름만 맞춘 빈 package를
먼저 만들지 않는다. 대신 기존 API 책임 package의 해당 vertical slice 가까이에 adapter를 둔다.

### API와 Gateway transport

```txt
apps/realtime-chat-api/
  src/app.ts
  src/runtime/create-runtime-deps.ts
  test/app-smoke.test.ts
  public-docs/runtime-contract.md

packages/realtime-chat-gateway/                       # 메시지 relay 책임 package가 도입되는 경우
  README.md
  public-docs/api.md
  public-docs/invariants.md
  src/message-send/...
  test/message-send-relay.test.ts

apps/realtime-chat-gateway/
  src/app.ts                                           # WebSocket 서버 조립만
  src/runtime/create-runtime-deps.ts
  src/runtime/realtime-chat-api-client.ts              # package로 이동 전의 임시 위치일 때
  test/app-smoke.test.ts
  test/realtime-chat-api-client.test.ts
  public-docs/runtime-contract.md
```

Gateway 메시지 해석과 relay가 커지면 `apps/realtime-chat-gateway/src/app.ts`에 계속 추가하지 않고
`packages/realtime-chat-gateway`로 내린다. 앱에는 소켓 서버, 설정, 조립, 종료 생명주기만 남긴다.

### web 연결

```txt
apps/web/src/features/chat/contracts.ts                # 임시 미러 제거 대상
apps/web/src/features/chat/transport/chatTransport.ts
apps/web/src/features/chat/transport/<실제 transport>.ts
apps/web/src/features/chat/useChatRoom.ts
```

web은 병합된 contracts package를 사용하고 `reason` 문자열을 임의로 재정의하지 않는다. Flow 4 이슈가
backend 전용이면 실제 transport와 화면 문구 변경은 별도 이슈로 분리할 수 있다.

## 6. 제안 공개 계약

최종 명칭은 메시지 전송 PR의 contracts를 기준으로 한다. 기존 계약과 다른
`CHANNEL_ACCESS_DENIED` 상수를 별도로 추가하지 않는다.

### Client -> Gateway

```json
{
  "type": "chat.message.send",
  "commandId": "cmd-001",
  "clientMessageId": "local-msg-001",
  "target": {
    "type": "channel",
    "channelId": "channel-1"
  },
  "content": {
    "type": "text",
    "text": "안녕하세요"
  }
}
```

`actorId`는 이 payload에 존재하지 않는다.

### API 도메인 결과

권한 거절은 처리에 성공한 정상 도메인 결과다.

```json
{
  "status": "rejected",
  "commandId": "cmd-001",
  "clientMessageId": "local-msg-001",
  "reason": "write_forbidden"
}
```

Gateway가 내부 HTTP로 API를 호출하는 경우 이 판별 합집합을 정상 응답 body로 받는 방식을 권장한다.
`403` 하나만 보고 거절 결과를 재구성하면 correlation 필드를 잃거나 통신 오류와 섞이기 쉽다. 정확한 HTTP
status는 메시지 전송 endpoint의 전체 정책과 함께 확정하되, API client는 정상 도메인 거절과 5xx,
timeout, schema 불일치를 반드시 구분해야 한다.

### Gateway -> Client

```json
{
  "type": "chat.message.rejected",
  "commandId": "cmd-001",
  "clientMessageId": "local-msg-001",
  "reason": "write_forbidden"
}
```

- `reason`은 기계 분기용 안정 코드다.
- 사용자 문구는 web에서 코드별로 관리하고 서버의 자유 형식 `message`를 분기 기준으로 쓰지 않는다.
- API timeout, 5xx, 네트워크 실패, 응답 schema 불일치는 `chat.message.rejected`로 위장하지 않고 별도의
  재시도 가능 `gateway.error` 계열 결과로 보낸다.

## 7. 처리와 오류 흐름

### 권한 거절

```txt
Client
-> Gateway: chat.message.send(commandId, clientMessageId, channel target, content)
-> Gateway: transport/session 검증, session에서 actorId 해석
-> API: 인증된 내부 문맥 + SendMessageRequest 전달
-> message-send: target -> stream 해석
-> message-send: 기존 accepted 멱등성 결과 조회
-> MessageWriteAuthorizer: 채널 쓰기 권한 확인
-> message-send: rejected(write_forbidden)
-> API: 정상 도메인 결과 반환
-> Gateway: chat.message.rejected relay
-> Client: clientMessageId에 해당하는 pending 항목을 failed로 전환
```

이 경로에서는 message insert, stream sequence update, delivery publish가 없다. 현재 PR은 기존 accepted
멱등성 결과를 권한 확인보다 먼저 반환한다. 이미 성공한 같은 요청을 재생한 경우 새 쓰기가 아니므로 기존
accepted를 그대로 반환하는 것을 기본안으로 한다. 권한 철회 뒤에도 기존 메시지 메타데이터를 반환하는
것이 보안 정책상 허용되는지 이슈 본문에서 명시적으로 확인한다.

### 권한 provider 장애

권한 provider timeout, DB 오류, 잘못된 응답을 `denied`로 낮추지 않는다. 이는 “권한 없음”이 아니라 결과를
판단할 수 없는 인프라 실패다.

```txt
권한상 denied -> chat.message.rejected(write_forbidden), 재시도해도 정책이 바뀌기 전에는 동일
권한 판단 실패 -> gateway.error 또는 API 5xx/timeout, 재시도 가능
```

fail-open은 금지한다. 권한 판단 실패 시 메시지를 저장하지 않되, 외부 결과는 정책 거절과 구분한다.

### 존재 여부 노출

private channel 비회원에게 `target_not_found`와 `write_forbidden` 중 무엇을 보여 줄지는 보안 계약이다.
기본 권고는 다음과 같다.

- 사용자가 존재를 볼 수 없는 private channel: `target_not_found`로 축약해 존재를 감춘다.
- 존재는 볼 수 있지만 쓰기만 불가능한 archived/read-only channel: `write_forbidden`.
- 내부 로그와 metric은 낮은 카디널리티의 내부 cause로 구분할 수 있지만 클라이언트 reason을 그대로
  로그 메시지에 복제하지 않는다.

이 정책은 resolver와 authorizer의 경계를 바꿀 수 있으므로 구현 전에 확정해야 한다.

## 8. 단계별 구현

1. **병합 후 계약 재확인**
   - 메시지 전송 PR의 최종 exports, 거절 사유, 유스케이스 호출 순서와 테스트를 확인한다.
   - Flow 4만을 위해 별도 message-send package나 중복 DTO를 만들지 않는다.
2. **채널 권한 표 작성**
   - public/private, member/non-member, archived/read-only, 관리자 예외를 표로 확정한다.
   - 존재 노출 정책과 기존 accepted 재시도 정책을 함께 기록한다.
3. **권한 provider 공개 계약 확정**
   - 최소 입력은 신뢰된 `actorId`와 `channelId`다.
   - 단순 허용·거절과 인프라 예외를 구분한다.
   - 권한 기준 상태 provider가 소유하고 message-send는 소비만 한다.
4. **`MessageWriteAuthorizer` adapter 구현**
   - channel target만 provider 계약으로 변환한다.
   - provider의 domain 값을 message-send의 `allowed | denied`로 번역한다.
   - DM/thread 정책을 임시로 허용하지 말고 해당 target 이슈에서 별도로 연결한다.
5. **message-send 거절 불변조건 테스트 보강**
   - 권한 거절 시 정확한 `commandId`, `clientMessageId`, `write_forbidden`을 반환한다.
   - append, ID 생성, sequence 갱신, publish를 호출하지 않음을 검증한다.
   - 기존 accepted 재시도는 합의된 정책대로 동작하는지 고정한다.
6. **API adapter와 런타임 조립**
   - 인증된 actor 문맥으로 message-send module을 호출한다.
   - 도메인 거절과 인프라 오류를 다른 응답 경로로 매핑한다.
   - endpoint와 상태 코드가 공개되면 API `public-docs/runtime-contract.md`를 같은 변경에서 갱신한다.
7. **Gateway relay 구현**
   - client payload에서 actor 값을 허용하지 않는다.
   - API 거절 응답의 correlation과 reason을 보존해 sender socket에만 전송한다.
   - API 장애는 재시도 가능 transport 오류로 보낸다.
   - WebSocket event가 공개되면 Gateway public contract를 같은 변경에서 갱신한다.
8. **web 실제 transport 연결**
   - backend contracts package를 import하고 임시 로컬 미러를 제거한다.
   - `write_forbidden`은 자동 재시도하지 않고 failed 상태와 권한 안내를 표시한다.
9. **통합 검증과 문서 승격**
   - 실제 PostgreSQL과 실제 API/Gateway 경계를 통과하는 거절 시나리오를 검증한다.
   - 확정된 계약만 provider `README.md`와 `public-docs`에 승격한다. 이 notes 문서를 에이전트 route에
     추가하지 않는다.

## 9. 테스트 계획

### message-send 단위 테스트

- `authorizeWrite`가 `denied`이면 `rejected(write_forbidden)`을 반환한다.
- 응답에 입력의 `commandId`와 `clientMessageId`가 그대로 남는다.
- `appendMessage`, `messageIdGenerator`, `outboundEventIdGenerator`,
  `publishDeliveryRequested`가 호출되지 않는다.
- 권한 provider 예외는 `write_forbidden`으로 변환되지 않고 위로 전파된다.
- 이미 accepted된 동일 `(senderActorId, streamId, clientMessageId)` 요청은 합의된 재시도 정책을 따른다.

### 권한 adapter 계약 테스트

- private channel member는 허용된다.
- private channel non-member는 거절된다.
- archived/read-only channel은 정책대로 거절된다.
- 관리자나 moderator 예외가 있다면 명시된 표대로만 허용된다.
- provider timeout/오류는 `denied`가 아니라 인프라 실패로 남는다.

### PostgreSQL 통합 테스트

- 거절 전후 `messages` 행 수가 같다.
- 대상 stream이 이미 있으면 `last_sequence`가 변하지 않는다.
- 대상 stream이 없으면 거절 요청만으로 stream row가 생기지 않는다.
- outbound delivery 기록 또는 outbox를 도입했다면 거절 요청으로 행이 생기지 않는다.

### API 테스트

- 요청 body의 `actorId`를 신뢰하지 않고 인증 문맥의 actor만 사용한다.
- 권한 거절을 정상 도메인 결과와 correlation 필드로 직렬화한다.
- 권한 provider 예외는 5xx/재시도 가능 오류이며 `write_forbidden`으로 위장하지 않는다.
- 응답 schema가 contracts package와 일치한다.

### Gateway 테스트

- 인증된 session의 actor로만 API를 호출한다.
- API의 rejected 결과를 sender socket에 정확히 한 번 relay한다.
- 다른 로컬 session에는 거절 event를 보내지 않는다.
- API timeout, 5xx, schema 불일치를 `chat.message.rejected(write_forbidden)`으로 보내지 않는다.
- malformed/oversized payload는 API를 호출하기 전에 transport 오류로 거절한다.

### API + Gateway 종단 테스트

```txt
Given private channel의 member가 아닌 actor가 Gateway에 인증되어 있고
And 해당 channel stream의 last_sequence가 N이며
When actor가 chat.message.send를 보낸다
Then actor는 같은 commandId/clientMessageId의 chat.message.rejected(write_forbidden)를 받고
And message 행은 추가되지 않고
And last_sequence는 N이며
And outbound delivery event는 발행되지 않는다.
```

web까지 포함하면 낙관적 메시지가 `pending -> failed`로 바뀌며 권한 거절은 자동 재시도하지 않는지도
검증한다.

## 10. 완료 조건

- 실제 권한 기준 상태를 사용하는 concrete `MessageWriteAuthorizer`가 조립돼 있다.
- Gateway 또는 선택된 직접 HTTP 전송 경로에서 신뢰된 actor만 message-send에 전달된다.
- `write_forbidden` 도메인 거절이 contracts, API, Gateway, web에서 같은 의미를 가진다.
- 권한 거절 시 메시지, stream sequence, delivery/outbox에 쓰기가 없다는 테스트가 통과한다.
- 권한 provider 장애가 정책 거절과 구분되고 fail-open하지 않는다.
- private channel 존재 노출 정책과 기존 accepted 재시도 정책이 문서와 테스트로 고정돼 있다.
- 외부에서 관찰 가능한 변경이 각 provider의 `README.md`와 `public-docs`에 반영돼 있다.
- 구현 세부와 테스트 전략은 소유 package의 `owner-docs`에 반영돼 있고, 이 notes 문서는 agent route에
  포함되지 않는다.

## 11. 비범위

- 채널 메시지 저장, sequence 발급, 멱등성 본체의 재구현
- outbound fan-out과 수신자 session 조회
- `afterSequence` 누락 복구
- read cursor와 unread 계산
- reconnect 전체 흐름
- collaboration system message
- presence
- DM participant 및 thread root 접근 권한 구현
- 채널 관리 UI, 멤버 초대, 역할 관리 기능
- 권한 캐시와 대규모 성능 최적화

## 12. 위험과 미결정

1. **권한 원천 부재**: 현재 저장소에는 channel membership의 기준 상태가 없다. 이 상태로는 운영 가능한
   권한 adapter를 완성할 수 없다.
2. **전송 경로 미확정**: 메시지 전송 PR은 직접 HTTP와 WebSocket relay를 모두 열어 두고 있다. 이를 먼저
   정하지 않으면 API/Gateway 공개 계약과 테스트 범위가 흔들린다.
3. **private channel 존재 노출**: `target_not_found`와 `write_forbidden`의 구분이 채널 존재를 노출할 수
   있다.
4. **권한 철회와 멱등성 재시도**: 현재 PR은 기존 accepted 결과를 권한 확인보다 먼저 반환한다. 이는
   일반적인 멱등성에는 맞지만 권한 철회 정책을 명시해야 한다.
5. **reason 이름 불일치**: 초기 흐름 문서의 `CHANNEL_ACCESS_DENIED`, PR의 `write_forbidden`, web 목의
   `MESSAGE_SAVE_FAILED`가 서로 다르다. 병합된 contracts 하나를 유일한 wire source로 삼아야 한다.
6. **앱 비대화**: 메시지 relay를 현재 `apps/realtime-chat-gateway/src/app.ts`에 계속 추가하면 얇은 런타임
   쉘 원칙을 깨뜨린다.
7. **거절과 장애 혼동**: provider 장애를 denied로 낮추면 운영 장애가 사용자 권한 문제로 보이고 복구도
   어려워진다.
8. **TOCTOU**: 권한 확인과 message append 사이에 membership 또는 channel 상태가 바뀔 수 있다. 강한
   일관성이 필요한 정책이라면 같은 DB transaction, version 검사, 또는 권한 원천이 제공하는 원자적
   command 경계가 필요한지 결정해야 한다. MVP에서 허용할 시간차도 명시한다.

## 13. 문서 경계 메모

- 이 파일은 `docs/realtime-chat/notes/implementation-plans/`의 사람용 배경 자료다.
- 소비자가 읽을 공개 계약 후보는 병합 후 아래 위치에 반영한다.
  - `packages/realtime-chat-message-send-contracts/README.md`
  - Gateway relay package가 생기면 해당 package의 `public-docs/api.md`, `public-docs/invariants.md`
  - `apps/realtime-chat-api/public-docs/runtime-contract.md`
  - `apps/realtime-chat-gateway/public-docs/runtime-contract.md`
- consumer에서 deny할 경로는 provider의 `owner-docs/`, `notes/`이며, 이 계획 파일도 agent route에 넣지
  않는다.
- owner는 각 provider의 `AGENTS.md`가 가리키는 `owner-docs/*`를 읽는다.
- parent directory deny 뒤 child public docs를 재개방하는 permission 구조는 사용하지 않는다.

