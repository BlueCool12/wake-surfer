# @wake-surfer/realtime-chat-message-contracts

`message-send`, stream query, 실시간 delivery가 공통으로 사용하는 versioned 외부 message value 계약이다.

## 공개 계약

- 공통 ID 타입, `MessageTarget`, canonical `StreamId` 계산 규칙
- `PublicMessage`와 `USER/TEXT` content의 타입 및 strict runtime schema
- UTF-8 기준 text 최대 8,192 byte 정책

`PublicMessage`의 canonical 외부 필드는 `senderActorId`, `target`, `content.type: "text"`다.
history item에는 `clientMessageId`를 포함하지 않는다. 현재 variant는 `USER/TEXT`만 지원하며 `SYSTEM`과
알 수 없는 variant는 parse하지 않는다.

`getCanonicalStreamId(target)`은 `{target.type}:{targetId}`를 반환한다. 예를 들어 channel target의
canonical stream ID는 `channel:{channelId}`다. send와 query는 각자의 resolver 규칙을 복제하지 않고 이
함수를 사용한다.

## 모듈 형식

브라우저와 Node 서버가 runtime schema를 같은 계약에서 사용한다. build는 소스를 번들하지 않고 ESM과
CommonJS로 각각 변환하며, package `exports`의 `import`와 `require` 조건이 실행 환경에 맞는 결과물을
선택한다. 타입 선언은 두 형식이 공유한다.

## 비공개 내부 모델

이 패키지는 다음을 소유하지 않는다.

- send command와 `clientMessageId` 기반 멱등성
- DB row, Kysely query, stream sequence 발급과 저장 transaction
- target 존재·권한 확인과 target별 resolver 정책
- HTTP/WebSocket transport envelope와 delivery 수신자 결정
