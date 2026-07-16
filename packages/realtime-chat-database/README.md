# @wake-surfer/realtime-chat-database

실시간 채팅 기능군이 공유하는 PostgreSQL 런타임 리소스 패키지다.

이 패키지는 feature 유스케이스를 구현하지 않는다. 책임은 `pg Pool`, Kysely 인스턴스, 전체 DB 타입
합성, 공통 마이그레이션 진입점으로 제한한다.

## 책임

- PostgreSQL 연결 풀을 생성한다.
- `Kysely<RealtimeChatDatabase>` 인스턴스를 생성한다.
- feature 패키지들이 제공하는 테이블 타입을 `RealtimeChatDatabase`로 합성한다.
- versioned migration을 공통 `migrate()`에서 순서와 checksum 이력에 따라 실행한다.
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

## Schema migration

`database.migrate()`는 PostgreSQL advisory lock 아래에서 migration을 직렬화하고,
`realtime_chat_schema_migrations`에 version, name, checksum, 적용 시각을 기록한다. 이미 적용된
migration의 name 또는 checksum이 달라지면 startup을 실패시킨다.

기존 `CREATE TABLE IF NOT EXISTS` bootstrap으로 만들어진 DB는 현재 gateway ticket/message schema의
table, column, key/FK/check constraint와 query에 필요한 secondary index 의미를 검증한 경우에만 명시적
legacy version `001`을 baseline으로 기록한다. 그 뒤의 migration은 순서대로 실제 실행한다. 정의가 다르거나
일부 table만 존재하면 migration 이력을 기록하지 않고 실패한다.

## 테이블 타입 합성

현재 전체 DB 타입은 gateway ticket과 message send feature의 테이블 타입을 합성한다.

```ts
export type RealtimeChatDatabase = GatewayTicketDatabase & MessageSendDatabase;
```

새 feature가 추가되면 각 feature가 자기 테이블 타입을 제공하고, 이 패키지가 교차 타입으로 합성한다.

```ts
export type RealtimeChatDatabase =
  GatewayTicketDatabase & MessageSendDatabase & AnotherFeatureDatabase;
```

의존 방향은 다음을 지킨다.

- `realtime-chat-database`는 feature의 DB 계약 타입을 참조한다.
- feature 패키지는 `realtime-chat-database`를 참조하지 않는다.
- 앱은 `realtime-chat-database`와 필요한 feature 패키지를 조립한다.

## PostgreSQL 통합 테스트

실제 PostgreSQL을 사용하는 통합 테스트는 이 패키지의 `./integration-test` 서브패스를 사용한다.
테스트 suite마다 `TEST_DATABASE_URL`로 연결한 DB에 고유한 임시 schema를 만들고, 공통 `migrate()`를
적용한다. `close()`는 테스트 성공·실패와 관계없이 해당 schema를 삭제한다.

```ts
import {
  createRealtimeChatIntegrationTestDatabase,
  type RealtimeChatIntegrationTestDatabase,
} from "@wake-surfer/realtime-chat-database/integration-test";
import { afterAll, beforeAll } from "vitest";

let database: RealtimeChatIntegrationTestDatabase | undefined;

beforeAll(async () => {
  database = await createRealtimeChatIntegrationTestDatabase();
});

afterAll(async () => {
  await database?.close();
});
```

`TEST_DATABASE_URL`은 필수이며 다른 runtime database URL로 대체하지 않는다. bootstrap migration이
실패하면 helper는 성공한 database handle을 반환하지 않고, 생성한 임시 schema를 정리한 뒤 실패를 다시
전파한다. 병렬 worker와 suite는 UUID가 포함된 서로 다른 schema를 사용한다.
