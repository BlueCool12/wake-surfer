# Stream Messages 내부 아키텍처

## 책임 경계

이 패키지는 인증된 actor를 위한 message stream 조회 유스케이스와 Kysely 구현만 소유한다. 외부
request/response나 HTTP/WebSocket runtime을 조립하지 않는다.

패키지는 다음을 소유한다.

- channel/DM 읽기 권한과 thread의 parent conversation 읽기 권한 확인
- canonical stream identity 해석
- exclusive cursor와 fixed-watermark 규칙
- count limit 기반 논리적 page
- sequence 정렬·연속성과 storage row 무결성
- Kysely 기반 read-only snapshot Query
- transport와 독립적인 target-aware `StreamMessage` 조회 모델

패키지는 다음을 소유하지 않는다.

- message write model과 `MessageSendDatabase`
- versioned transport contract와 canonical serializer
- HTTP route, internal API client와 WebSocket relay
- final-envelope byte budget, rate limit, timeout, request ID와 logging

## 버티컬 슬라이스

Query는 다음 세 버티컬 슬라이스로 나눈다.

```text
src/usecases/
├─ load-latest/
│  ├─ load-latest.usecase.ts
│  └─ load-latest.kysely.ts
├─ load-older/
│  ├─ load-older.usecase.ts
│  └─ load-older.kysely.ts
└─ sync-after/
   ├─ sync-after.usecase.ts
   └─ sync-after.kysely.ts
```

각 `.usecase.ts`가 자기 factory, Query/Context, 결과 page와 의존성 타입을 함께 소유한다. package root는
세 factory를 각각 export하며 다시 하나의 facade로 묶지 않는다. 각 `.kysely.ts`는 해당 Query의 snapshot,
범위·정렬 SQL, cursor 유효성과 storage integrity를 소유한다.

예상 가능한 유스케이스 실패는 `status: "failure"` 값으로 반환한다. 권한 판정의 `denied`는
`stream_unavailable`로, snapshot의 현재 head와 맞지 않는 cursor는 `invalid_cursor`로 번역한다. storage
row 훼손과 DB 장애는 정상 실패값으로 바꾸지 않고 예외로 전파한다.
존재하지 않는 thread stream도 `stream_unavailable`이며, 이미 생성된 thread는 root message가
tombstone이어도 조회할 수 있다.

## 의존 원칙

Kysely와 Query 유스케이스의 결합은 의도적으로 허용한다. SQL을 그대로 전달하는 repository port는 만들지
않는다.

Stream Messages는 물리적으로 `message_streams`와 `messages`를 함께 사용하더라도 쓰기 feature의 table
타입을 재사용하지 않는다. `StreamMessagesDatabase`는 읽기에 필요한 열만 독립적으로 선언하며, 실제 전체
database 타입은 TypeScript structural typing으로 이 계약을 만족한다.

`messages.content` JSONB는 package 내부 parser로 현재 저장 형식을 검증한 뒤 `StreamMessage.content`로
명시적으로 변환한다. Target은 `messages`의 중복 열이 아니라 `message_streams`에서 읽는다.

Query별 cursor, watermark, 조회 방향과 page 진행 의미는 공통화하지 않는다. row parsing이나 공통 오류처럼
Query 의미가 없는 안정된 primitive만 공유한다.

DB 조회 결과는 정적 table 타입을 그대로 신뢰하지 않고 `RawStreamMetadataRow`와
`RawStreamMessageRow`의 `unknown` 필드로 받은 뒤 검증한다. 세 Query가 공통으로 읽는 stream metadata의
missing/target/head 검증은 `parseMessageStreamMetadata`가 한 번만 소유한다.

## 전송 경계

유스케이스는 count 기준의 논리적 page를 반환한다. `realtime-chat-api` app이 외부 HTTP contract 검증,
인증된 actor context 연결, 48KiB final-envelope 조정, 직렬화와 오류 mapping을 소유한다. Gateway-side
internal API client와 WebSocket relay는 `@wake-surfer/realtime-chat-stream-messages-gateway`가 소유한다.

의존 방향은 항상 transport/app에서 이 패키지로 향하며 이 패키지는 transport contract나 adapter를 역으로
참조하지 않는다.

따라서 이 패키지는 app 간 wire contract나 다른 message usecase provider에 의존하지 않는다. 내부
`StreamMessage`를 외부 `PublicMessage`와 stream response로 바꾸는 작업은 소비 app의 조립 경계가 담당한다.
`streamId`는 DB partition 조회와 무결성 검증에만 사용하며 page 결과에는 노출하지 않는다.
