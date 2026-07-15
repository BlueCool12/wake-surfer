# RCI-02 Read Cursor table contract와 database migration 합성

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-01](./RCI-01.md)
- [SMI-03 PostgreSQL 통합 테스트 기반](../../stream-messages/issues/SMI-03.md)
- [SMI-23 versioned migration runner](../../stream-messages/issues/SMI-23.md)

### 관련 설계

- [Slice와 aggregate](../design/02-slice-and-aggregate.md)
- [동시성과 멱등성](../design/05-concurrency-and-idempotency.md)

## 작업 정의

**목표**

`@wake-surfer/realtime-chat-read-cursor` package 기반과 `read_cursors` table contract를 만들고 공통 database
migration에 안전하게 합성한다.

**주요 변경**

- feature package와 table-contract subpath
- `(user_id, stream_id)` 복합 primary key
- non-negative safe sequence에 맞는 DB column/constraint
- 실제 전진 시각과 no-op 불변을 지원하는 timestamp
- `message_streams.stream_id`를 향한 `NO ACTION` FK
- `realtime-chat-database` DB type/migration 합성

**완료 조건**

- 신규 DB와 upgrade DB에서 migration이 idempotent하다.
- row 없음은 effective cursor 0으로 해석할 수 있다.
- `mark(0)`을 위해 row를 만들 필요가 없다.
- 동일 user/stream 중복 row를 DB가 차단한다.
- feature package가 database runtime package를 역으로 의존하지 않는다.
- 실제 PostgreSQL에서 FK, PK, constraint contract test가 통과한다.

**비범위**

- conditional upsert Handler
- identity user table FK
- retention cascade

권장 브랜치 slug: `read-cursor-table`
