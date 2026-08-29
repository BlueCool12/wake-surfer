# @wake-surfer/realtime-chat-message-send

`realtime-chat`의 메시지 저장 command를 처리하는 transport-agnostic 패키지다.

channel, DM, thread target에 대한 공통 message append 파이프라인을 제공한다. channel과 DM의 target
해석 및 모든 target의 쓰기 권한 판단은 consumer가 주입한다. Thread target은 `threadId`와 같은 ID의
root message를 기준으로 package가 thread stream 생성 가능 여부를 검증한다.

## 공개 API

- `createSendMessage(dependencies)`: `SendMessage` 함수를 생성한다.
- `SendMessageInput`: `senderActorId`, sender-scoped `idempotencyKey`, `target`, `text`를 받는다.
- `SendMessageResult`: 저장된 `AppendedTextMessage`와 `created | existing` 저장 결과를 담은
  `accepted` 또는 거절 이유를 담은 `rejected`를 반환한다.
- `toAcceptedTextMessage(message)`: 내부 `Date`를 ISO datetime 문자열로 변환한 send response
  message value를 만든다.
- `./persisted-message-content`: `messages.content` JSONB의 canonical text schema와 codec을 제공한다.

`createSendMessage`에는 `db`, `resolveTarget`, `authorizeWrite`를 필수로 주입한다. message ID 생성기는
필요할 때 대체할 수 있고 생성 시각은 PostgreSQL `created_at DEFAULT now()`가 정한다.

## 관찰 가능한 동작

- text는 앞뒤 공백을 제거한 뒤 저장하며, 빈 문자열과 UTF-8 8,192 byte 초과를
  `invalid_text`로 거절한다.
- target resolve 실패와 쓰기 권한 거절은 각각 `target_not_found`, `write_forbidden`으로
  반환한다.
- 같은 sender의 같은 `idempotencyKey`로 같은 canonical request fingerprint를 재시도하면
  `send_message_receipts`가 가리키는 기존 메시지를 `persistence: "existing"`인 `accepted`로 반환한다.
- 해당 기존 메시지가 이미 삭제됐다면 원문을 복원하지 않고 `message_deleted`로 거절한다.
- 같은 sender와 `idempotencyKey`를 다른 target 또는 text에 재사용하면
  `idempotency_conflict`로 거절한다.
- 새 메시지는 resolve된 stream의 head를 원자적으로 증가시키고 JSONB content, 불변 receipt와 함께 같은
  transaction으로 저장되며 `persistence: "created"`인 `accepted`로 반환된다.
- 최초 thread message는 active channel 또는 DM root message만 대상으로 하며, root row 검증과 thread
  stream 생성, message append, receipt 저장을 같은 transaction에서 처리한다.
- 존재하지 않는 root, 삭제된 root의 신규 thread와 thread message를 root로 한 중첩 thread는
  `target_not_found`로 거절한다.
- 이미 생성된 thread는 root가 나중에 삭제되더라도 유지하며, consumer의 쓰기 권한 판정을 통과하면 새
  message를 append한다.

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
- channel / DM의 존재·멤버십과 target별 외부 capability 정책 확정

## Database contract

이 패키지는 `./table-contract` 서브패스로 `MessageSendDatabase` 타입을 제공하고
`send_message_receipts`, `message_streams`, `messages` 중 실제 query가 사용하는 좁은 계약만 소유한다.
`messages.content`의 canonical runtime parser는 `./persisted-message-content`가 소유한다. Schema SQL과 적용
책임은 `@wake-surfer/realtime-chat-database`가 소유한 Atlas versioned migration에 있다.

패키지 내부 경로는 공개 API가 아니므로 deep import하지 않는다.
