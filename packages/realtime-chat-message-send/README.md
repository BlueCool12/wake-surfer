# @wake-surfer/realtime-chat-message-send

`realtime-chat`의 메시지 저장 command를 처리하는 transport-agnostic 패키지다.

channel, DM, thread target에 대한 공통 message append 파이프라인을 제공한다. target을
stream으로 해석하는 규칙과 쓰기 권한 판단은 consumer가 주입한다.

## 공개 API

- `createSendMessage(dependencies)`: `SendMessage` 함수를 생성한다.
- `SendMessageInput`: `senderActorId`, sender-scoped `idempotencyKey`, `target`, `text`를 받는다.
- `SendMessageResult`: 저장된 `AppendedTextMessage`를 담은 `accepted` 또는 거절 이유를 담은
  `rejected`를 반환한다.
- `toAcceptedTextMessage(message)`: 내부 `Date`를 ISO datetime 문자열로 변환한 send response
  message value를 만든다.

`createSendMessage`에는 `db`, `resolveTarget`, `authorizeWrite`를 필수로 주입한다. message ID
생성기와 server clock은 필요할 때 대체할 수 있다.

## 관찰 가능한 동작

- text는 앞뒤 공백을 제거한 뒤 저장하며, 빈 문자열과 UTF-8 8,192 byte 초과를
  `invalid_text`로 거절한다.
- target resolve 실패와 쓰기 권한 거절은 각각 `target_not_found`, `write_forbidden`으로
  반환한다.
- 같은 sender의 같은 `idempotencyKey`로 같은 target과 정규화된 text를 재시도하면 기존
  메시지를 `accepted`로 반환한다.
- 같은 sender와 `idempotencyKey`를 다른 target 또는 text에 재사용하면
  `idempotency_conflict`로 거절한다.
- 새 메시지는 resolve된 stream 내에서 sequence를 발급받고 transaction으로 저장된다.

## 책임이 아닌 것

- HTTP 라우팅과 WebSocket 라우팅
- 외부 요청 본문 validation schema
- send response envelope 조립
- outbound delivery event 발행과 수신자 계산
- Gateway local session fan-out
- stream sync
- read cursor
- system message
- presence / typing indicator
- channel / DM / thread별 세부 비즈니스 정책 확정

## Database contract

이 패키지는 `./table-contract` 서브패스로 `MessageSendDatabase` 타입만 제공한다. `message_streams`와
`messages`의 schema SQL 및 적용 책임은 `@wake-surfer/realtime-chat-database`가 소유한 Atlas versioned
migration에 있다.

패키지 내부 경로는 공개 API가 아니므로 deep import하지 않는다.
