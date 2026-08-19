# @wake-surfer/realtime-chat-database

실시간 채팅 기능군이 공유하는 PostgreSQL 런타임 리소스 패키지다.

이 패키지는 feature 유스케이스를 구현하지 않는다. runtime 책임은 `pg Pool`, Kysely 인스턴스, 전체 DB
타입 합성으로 제한한다. 같은 module directory가 realtime-chat Atlas migration 자산과 전용 Docker
container를 소유한다.

## 책임

- PostgreSQL 연결 풀을 생성한다.
- `Kysely<RealtimeChatDatabase>` 인스턴스를 생성한다.
- feature 패키지들이 제공하는 테이블 타입을 `RealtimeChatDatabase`로 합성한다.
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

await gatewayTicket.issue({
  actorId: "actor-1",
});

await database.close();
```

앱은 DB 리소스 생명주기를 조립하지만, feature 내부 저장 함수나 SQL 쿼리를 알지 않는다.

## Schema migration

스키마의 단일 원본은 `./migrations`의 Atlas versioned migration이다. `atlas.sum`은 migration 파일의
순서와 내용 무결성을 보호한다. 애플리케이션은 시작할 때 migration을 실행하지 않으며, 이 패키지의
`docker/compose.yml`이 소유하고 root Compose가 include하는 일회성 `realtime-chat-migrate` service가
애플리케이션보다 먼저 적용해야 한다.

```bash
pnpm db:validate:realtime-chat
pnpm db:migrate:realtime-chat
```

현재 운영 데이터가 없는 단계이므로 `20260719000000_initial.sql` 하나가 확정된 6개 테이블의 최종
baseline을 만든다. 과거 `messages.idempotency_key` migration은 이 baseline에 흡수됐고, 전송 멱등성의
authority는 `send_message_receipts`다. 새 database는 `atlas migrate apply`로 이 baseline을 직접 적용한다.

이후 새 schema 변경은 기존 baseline을 다시 쓰지 않고 새 versioned SQL migration으로 추가한 뒤
`atlas.sum`을 갱신한다. 이 저장소에는 `schema apply`나 `migrate diff` 자동 생성 경로가 없으며 migration
실행은 항상 `atlas migrate apply`를 사용한다.

## 테이블 타입 합성

현재 전체 DB 타입은 gateway ticket, message send, stream messages feature의 테이블 타입을 합성한다.

```ts
export type RealtimeChatDatabase =
  GatewayTicketDatabase & MessageSendDatabase & StreamMessagesDatabase;
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
