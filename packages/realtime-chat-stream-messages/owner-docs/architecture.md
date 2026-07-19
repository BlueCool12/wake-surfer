# Stream Messages 내부 아키텍처

## 모듈 책임

`StreamMessagesModule`은 인증된 actor를 위한 channel message 조회 유스케이스를 제공한다. HTTP 또는
WebSocket 응답 생성기가 아니다.

모듈은 다음을 소유한다.

- channel 읽기 권한 확인
- canonical stream identity 해석
- exclusive cursor와 fixed-watermark 규칙
- count limit 기반 논리적 page
- sequence 정렬·연속성과 storage row 무결성
- Kysely 기반 read-only snapshot Query

모듈은 다음을 소유하지 않는다.

- message write model과 `MessageSendDatabase`
- HTTP 또는 WebSocket request/response 타입
- canonical JSON 직렬화와 최종 UTF-8 envelope 측정
- rate limit, timeout, request ID, logging

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

각 `.usecase.ts`는 actor 권한, stream identity와 결과 page를 조립한다. 각 `.kysely.ts`는 해당 Query의
snapshot, 범위·정렬 SQL, cursor 유효성 및 storage integrity를 소유한다.

`stream-messages-module.ts`는 세 슬라이스에 의존성을 전달하는 얇은 facade로만 유지한다.

## 의존 원칙

Kysely와 Query 유스케이스의 결합은 의도적으로 허용한다. SQL을 그대로 전달하는 repository port는 만들지
않는다.

Stream Messages는 물리적으로 `message_streams`와 `messages`를 함께 사용하더라도 쓰기 feature의 table
타입을 재사용하지 않는다. `StreamMessagesDatabase`는 읽기에 필요한 열만 독립적으로 선언하며, 실제 전체
database 타입은 TypeScript structural typing으로 이 계약을 만족한다.

Query별 cursor, watermark, 조회 방향과 page 진행 의미는 공통화하지 않는다. row parsing이나 공통 오류처럼
Query 의미가 없는 안정된 primitive만 공유한다.

## 전송 크기 경계

유스케이스는 count limit 기준의 논리적 page를 반환한다. `page-policy.ts`는 전송 어댑터가 제공한 canonical
envelope measurer를 사용해 최종 크기에 맞는 연속 message 범위를 선택하고 continuation cursor를 다시
계산한다. 앱은 이 정책을 구현하지 않고 package adapter를 조립한다.
