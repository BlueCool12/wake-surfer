# ADR 002. realtime-chat runtime dependency 선택

## 상태

Accepted

## 날짜

2026-07-04

## 배경

`packages/realtime-chat`은 feature 구현과 port/interface를 소유하지만, concrete runtime dependency는 app/runtime adapter에서 주입받습니다.

따라서 HTTP framework, validation library, logger, SQL query layer, WebSocket library는 app package가 생길 때 실제 import하는 app의 `package.json`에 선언해야 합니다.

root `package.json`은 runtime dependency를 모으는 장소가 아닙니다. root는 workspace orchestration과 공통 dev tooling만 관리합니다.

```txt
root package.json
  = workspace scripts
  + lint/format/test/build orchestration
  + TypeScript/ESLint/Prettier 같은 공통 dev tooling

apps/*
  = 실제 runtime dependency 선언
  = Hono/Kysely/pg/ws/pino/zod 같은 concrete adapter dependency

packages/realtime-chat
  = @wake-surfer/realtime-chat-contracts
  = feature port/interface

packages/realtime-chat-contracts
  = 외부 runtime dependency 없음
```

## 결정

다음 runtime dependency 방향을 채택합니다.

| 용도                 | 결정   | 이유                                                                                    |
| -------------------- | ------ | --------------------------------------------------------------------------------------- |
| HTTP framework       | Hono   | 얇은 app shell과 잘 맞고, Web Standards 기반이며 adapter가 단순합니다.                  |
| Validation           | Zod    | env/request/socket payload validation의 기본 선택지로 둡니다.                           |
| Logger               | Pino   | 빠르고 구조화 JSON 로그에 강하며 Node backend 기본 선택지로 적합합니다.                 |
| SQL query layer      | Kysely | Spring Data JDBC에 가까운 명시적 DB 접근 방식입니다. JPA/Prisma식 ORM magic을 피합니다. |
| Production DB driver | pg     | 운영 DB가 PostgreSQL일 때 Kysely PostgresDialect에 사용합니다.                          |
| WebSocket            | ws     | Node WebSocket server/client의 단순하고 널리 쓰이는 선택지입니다.                       |

앱이 아직 만들어지지 않았으므로 Hono/Kysely/pg/ws/pino/zod는 지금 설치하지 않습니다. app package가 생길 때 실제 import하는 app의 `package.json`에 선언합니다.

## 보류한 대안

| 항목    | 보류 이유                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Fastify | 운영 framework 기능과 plugin 생태계는 좋지만, 현재는 얇은 app shell과 Hono가 더 잘 맞습니다.                |
| Prisma  | generated client 중심 ORM 성격이 강하고, sequence/lock/upsert 중심의 persistence 요구와 취향에 덜 맞습니다. |
| Drizzle | 좋은 대안이지만, 현재 취향은 Spring Data JDBC에 가까운 명시적 SQL query builder이고 Kysely가 더 맞습니다.   |

## 결과

app package가 생기면 예시는 다음과 같습니다.

```txt
apps/realtime-chat-api
  dependencies:
    @wake-surfer/realtime-chat
    hono
    @hono/node-server
    @hono/zod-validator
    zod
    pino
    kysely
    pg

apps/realtime-chat-gateway 또는 apps/realtime-gateway
  dependencies:
    @wake-surfer/realtime-chat
    zod
    pino
    ws
```

구체적인 dependency 선언은 app 생성 시점에 실제 import 기준으로 확정합니다.
