# ADR 003. realtime-chat 개발 DB 방향

## 상태

Accepted

## 날짜

2026-07-04

## 배경

Realtime chat persistence는 단순 CRUD보다 DB 동작의 정확성이 중요합니다.

중요한 DB 동작:

- `streamId + sequence` 순번 발급
- sequence 중복 방지
- `clientMessageId` 멱등성
- gateway ticket atomic consume
- read cursor no-backward update
- `afterSequence` sync

PostgreSQL과 SQLite는 migration DDL, locking, transaction, `RETURNING`, upsert semantics가 다를 수 있습니다. 특히 Postgres의 `SELECT FOR UPDATE` 같은 row lock 방식은 SQLite와 직접 대응되지 않습니다.

## 결정

운영 DB는 PostgreSQL을 전제로 검토합니다.

로컬 개발은 다음 순서로 선호합니다.

1. Docker Compose로 PostgreSQL을 띄워 운영 DB와 같은 dialect로 개발합니다.
2. 빠른 smoke/demo가 필요하면 `RealtimeChatDbPort`의 in-memory adapter를 둡니다.
3. SQLite는 필요성이 커질 때 별도 adapter로 검토합니다.

SQLite를 primary dev DB로 확정하지 않습니다.

## 보류한 대안

| 항목           | 보류 이유                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite 개발 DB | PostgreSQL과 locking, migration DDL, returning, concurrency semantics가 다릅니다. 개발 편의용으로는 가능하지만 primary dev DB로 확정하지 않습니다. |

## 결과

DB adapter는 `RealtimeChatDbPort`를 기준으로 분리할 수 있게 둡니다.

```txt
RealtimeChatDbPort
  ├─ PostgresRealtimeChatDb
  ├─ InMemoryRealtimeChatDb
  └─ SqliteRealtimeChatDb   # 필요해질 때만 검토
```

PostgreSQL schema와 migration 전략은 DB adapter 구현 전에 별도 ADR로 기록합니다.
