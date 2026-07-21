# @wake-surfer/realtime-chat-message-send-contracts

`message-send` 기능의 요청·응답 경계에서 공유되는 타입과 validation schema를 담는다.

`PublicMessage`, target, text content, 공통 ID와 canonical stream identity는
`@wake-surfer/realtime-chat-message-contracts`가 소유한다. 이 패키지는 해당 공개 계약을 재사용한다.

기존 `SendMessageTarget`, `SendMessageContent`, `PublicMessage` export는 consumer 호환성을 위해 공통
계약의 alias로 유지한다.

## 모듈 형식

브라우저와 Node 서버가 runtime schema를 같은 계약에서 사용한다. build는 소스를 번들하지 않고 ESM과
CommonJS로 각각 변환하며, package `exports`의 `import`와 `require` 조건이 실행 환경에 맞는 결과물을
선택한다. 타입 선언은 두 형식이 공유한다.

## 책임

- message-send 요청/응답 타입을 정의한다.
- message-send request body validation schema와 parser를 제공한다.
- message-send command correlation과 accepted/rejected response를 정의한다.
- outbound delivery 요청 event의 send 전용 envelope을 정의한다.

## 책임이 아닌 것

- 공통 message value와 target -> canonical stream ID 규칙
- target -> stream resolve 정책 구현
- 메시지 저장 transaction
- stream sequence 발급
- 쓰기 권한 판단
- Gateway fan-out
