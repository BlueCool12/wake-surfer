# @wake-surfer/realtime-chat-message-mutation-contracts

Web, Gateway, API가 공유하는 메시지 수정 요청과 삭제 요청의 타입 및 실행 중 검사 스키마를 제공한다.

수정과 삭제는 서로 다른 명령이다. 이 패키지는 두 요청을 하나의 통합 요청으로 만들지 않는다.

## 공개 계약

- `EditMessageRequestSchema`, `EditMessageRequest`, `parseEditMessageRequest`
- `DeleteMessageRequestSchema`, `DeleteMessageRequest`, `parseDeleteMessageRequest`

수정 요청은 변경할 `messageId`와 기존 본문을 대체할 `text`를 전달한다. 삭제 요청은 삭제할
`messageId`만 전달한다.

요청 계약은 필드의 구조와 자료형을 검사한다. 수정 본문의 공백 여부와 길이 같은 업무 규칙은 메시지 수정
기능에서 판단한다.

## 모듈 형식

브라우저와 Node 서버가 같은 스키마를 사용할 수 있도록 ESM과 CommonJS 결과물을 함께 제공한다.
