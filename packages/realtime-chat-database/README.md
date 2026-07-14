# @wake-surfer/realtime-chat-database

실시간 채팅 기능군이 공유하는 PostgreSQL 런타임 리소스 패키지다.

이 패키지는 feature 유스케이스를 구현하지 않는다. 책임은 `pg Pool`, Kysely 인스턴스, 전체 DB 타입
합성, 공통 마이그레이션 진입점으로 제한한다.

## 책임

- PostgreSQL 연결 풀을 생성한다.
- `Kysely<RealtimeChatDatabase>` 인스턴스를 생성한다.
- feature 패키지들이 제공하는 테이블 타입을 `RealtimeChatDatabase`로 합성한다.
- feature 패키지들이 제공하는 테이블 생성 함수를 공통 `migrate()`에서 실행한다.
- 앱 종료 시 호출할 `close()`를 제공한다.

## 책임이 아닌 것

- 게이트웨이 티켓 발급/소비 규칙
- feature별 SQL 쿼리 소유
- HTTP, WebSocket, 인증, 로깅 구성
- 환경 변수 파싱 정책

## 사용 예시

```ts
import { createRealtimeChatDatabase } from "@wake-surfer/realtime-chat-database";
import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";

const database = createRealtimeChatDatabase({
  databaseUrl: process.env.REALTIME_CHAT_DATABASE_URL,
  pool: {
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
    maxLifetimeSeconds: 300,
    statementTimeoutMillis: 2_000,
  },
});

const gatewayTicket = createGatewayTicketModule({
  db: database.db,
  assignGateway: createStaticGatewayAssigner({
    gatewayId: "gateway-1",
    gatewayUrl: "wss://gateway.example.com/realtime-chat",
  }),
  ticketTtlMilliseconds: 60_000,
  rawTicketBytes: 32,
});

await database.migrate();

await gatewayTicket.issue({
  actorId: "actor-1",
});

await database.close();
```

앱은 DB 리소스 생명주기를 조립하지만, feature 내부 저장 함수나 SQL 쿼리를 알지 않는다.

## 테이블 타입 합성

현재 전체 DB 타입은 게이트웨이 티켓 feature의 테이블 타입으로 시작한다.

```ts
export type RealtimeChatDatabase = GatewayTicketDatabase;
```

새 feature가 추가되면 각 feature가 자기 테이블 타입을 제공하고, 이 패키지가 교차 타입으로 합성한다.

```ts
export type RealtimeChatDatabase = GatewayTicketDatabase & AnotherFeatureDatabase;
```

의존 방향은 다음을 지킨다.

- `realtime-chat-database`는 feature의 DB 계약 타입을 참조한다.
- feature 패키지는 `realtime-chat-database`를 참조하지 않는다.
- 앱은 `realtime-chat-database`와 필요한 feature 패키지를 조립한다.
