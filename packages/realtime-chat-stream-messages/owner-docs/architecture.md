# Stream Messages 내부 아키텍처

## 책임 경계

이 패키지는 인증된 actor를 위한 channel message 조회 유스케이스와 Kysely 구현만 소유한다. 외부
request/response나 HTTP/WebSocket runtime을 조립하지 않는다.

패키지는 다음을 소유한다.

- channel 읽기 권한 확인
- canonical stream identity 해석
- exclusive cursor와 fixed-watermark 규칙
- count limit 기반 논리적 page
- sequence 정렬·연속성과 storage row 무결성
- Kysely 기반 read-only snapshot Query

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

## 의존 원칙

Kysely와 Query 유스케이스의 결합은 의도적으로 허용한다. SQL을 그대로 전달하는 repository port는 만들지
않는다.

Stream Messages는 물리적으로 `message_streams`와 `messages`를 함께 사용하더라도 쓰기 feature의 table
타입을 재사용하지 않는다. `StreamMessagesDatabase`는 읽기에 필요한 열만 독립적으로 선언하며, 실제 전체
database 타입은 TypeScript structural typing으로 이 계약을 만족한다.

Query별 cursor, watermark, 조회 방향과 page 진행 의미는 공통화하지 않는다. row parsing이나 공통 오류처럼
Query 의미가 없는 안정된 primitive만 공유한다.

## 전송 경계

유스케이스는 count 기준의 논리적 page를 반환한다. `realtime-chat-api` app이 외부 HTTP contract 검증,
인증된 actor context 연결, 48KiB final-envelope 조정, 직렬화와 오류 mapping을 소유한다. Gateway-side
internal API client와 WebSocket relay는 `@wake-surfer/realtime-chat-stream-messages-gateway`가 소유한다.

의존 방향은 항상 transport/app에서 이 패키지로 향하며 이 패키지는 transport contract나 adapter를 역으로
참조하지 않는다.
