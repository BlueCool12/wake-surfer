# SMI-23 Realtime Chat versioned migration runner 구축

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-03](./SMI-03.md)

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [09-performance-and-payload.md](../design/09-performance-and-payload.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-23. Realtime Chat versioned migration runner 구축

**목표**

`CREATE TABLE IF NOT EXISTS` bootstrap만으로는 적용할 수 없는 기존 schema upgrade를 순서와 이력에 따라
안전하게 실행한다.

**완료 조건**

- `realtime_chat_schema_migrations`에 version, name, checksum, applied time을 기록한다.
- migration은 PostgreSQL advisory lock 아래에서 한 번에 한 process만 실행한다.
- 새 DB는 ordered migration으로 현재 gateway ticket/message schema를 만든다.
- 기존 DB는 현재 schema shape를 검증한 뒤 명시적인 baseline을 기록하며 잘못된 shape를 묵시 승인하지
  않는다.
- 이미 적용된 checksum이 바뀌면 startup/migration을 실패시킨다.
- transaction 가능한 migration은 transaction으로 실행하고 실패 version을 적용 완료로 기록하지 않는다.
- `database.migrate()` public contract와 API startup lifecycle은 유지한다.
- fresh DB, existing baseline, concurrent migrate, checksum mismatch 통합 테스트가 있다.

권장 브랜치 slug: `realtime-chat-migration-runner`

---
