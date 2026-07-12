# @wake-surfer/realtime-chat-message-send-contracts

`message-send` 기능의 외부 경계에서 공유되는 타입과 validation schema를 담는다.

이 패키지는 서버 내부 command, DB row, query helper, 권한 정책을 소유하지 않는다.

## 책임

- message-send 요청/응답 타입을 정의한다.
- channel / DM / thread target 입력 타입을 정의한다.
- message-send request body validation schema와 parser를 제공한다.
- 저장된 메시지와 outbound delivery 요청 이벤트의 외부 계약을 정의한다.

## 책임이 아닌 것

- target -> stream resolve 구현
- 메시지 저장 transaction
- stream sequence 발급
- 쓰기 권한 판단
- Gateway fan-out
