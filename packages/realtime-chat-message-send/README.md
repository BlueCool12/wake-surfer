# @wake-surfer/realtime-chat-message-send

`realtime-chat`의 메시지 전송 책임을 담는 패키지다.

현재 단계에서 `message-send`는 channel, DM, thread target에 대한 공통 message append 파이프라인을
소유한다. target별 세부 비즈니스 정책은 아직 확정하지 않고, target을 stream으로 해석하는 경계와 쓰기
권한 확인 경계만 둔다.

## 책임

- 클라이언트가 보낸 메시지 전송 의도를 서버 내부 command로 처리한다.
- target을 stream으로 해석한다.
- 메시지 content 정책을 검증한다.
- 쓰기 권한 확인 경계를 호출한다.
- `clientMessageId` 기반 멱등성을 보장한다.
- stream 내 sequence를 발급하고 메시지를 저장한다.
- accepted/rejected 결과를 반환한다.
- 저장된 메시지에 대한 outbound delivery 요청 이벤트를 발행한다.

## 책임이 아닌 것

- HTTP 라우팅과 WebSocket 라우팅
- 외부 요청 본문 validation schema
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
