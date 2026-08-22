# @wake-surfer/realtime-chat-message-contracts

transport와 저장 구현에 독립적인 공개 message value 계약을 제공한다.

## 공개 계약

- 공통 ID 타입, `MessageTarget`, canonical `StreamId` 계산 규칙
- `PublicMessage`와 text content의 타입 및 strict runtime schema
- UTF-8 기준 text 최대 8,192 byte 정책

`PublicMessage`는 active text message와 tombstone의 union이다. active message는 기존
`{ type: "text", text }` content와 선택적인 `editedAt`을 유지한다. 삭제된 message는 `content: null`과 `deletedAt`을 가지며
원문을 노출하지 않는다. 두 variant 모두 `messageId`, `streamId`, `sequence`, `senderActorId`, `target`,
`createdAt`을 포함하고 `sentAtClient`를 선택적으로 받는다. 알 수 없는 필드와 variant는 strict runtime
schema가 거절한다.

`getCanonicalStreamId(target)`은 `{target.type}:{targetId}`를 반환한다. 예를 들어 channel target의
canonical stream ID는 `channel:{channelId}`다. canonical stream identity가 필요한 consumer는 이 함수를
사용하고 규칙을 복제하지 않는다.

## 모듈 형식

브라우저와 Node 서버가 runtime schema를 같은 계약에서 사용한다. build는 소스를 번들하지 않고 ESM과
CommonJS로 각각 변환하며, package `exports`의 `import`와 `require` 조건이 실행 환경에 맞는 결과물을
선택한다. 타입 선언은 두 형식이 공유한다.

## 책임이 아닌 것

이 패키지는 다음을 소유하지 않는다.

- send request/response envelope와 멱등성 키 정책
- DB row, Kysely query, stream sequence 발급과 저장 transaction
- target 존재·권한 확인과 target별 resolver 정책
- HTTP/WebSocket transport envelope와 delivery 수신자 결정

패키지 내부 경로는 공개 API가 아니므로 deep import하지 않는다.
