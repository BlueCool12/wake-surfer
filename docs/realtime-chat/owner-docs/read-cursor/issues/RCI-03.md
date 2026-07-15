# RCI-03 Mark Read Cursor Command 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-01](./RCI-01.md)
- [RCI-02](./RCI-02.md)
- [SMI-03 PostgreSQL 통합 테스트 기반](../../stream-messages/issues/SMI-03.md)

### 관련 설계

- [Mark 의미](../design/03-mark-semantics.md)
- [Identity와 권한](../design/04-identity-and-authorization.md)
- [동시성과 멱등성](../design/05-concurrency-and-idempotency.md)
- [Acceptance criteria](../design/09-acceptance-and-non-goals.md)

## 작업 정의

**목표**

독립 Command input/output과 하나의 Handler를 가진 `mark-read-cursor` slice를 구현한다.

**주요 변경**

- trusted principal→human user, channel authorization consumer contract
- channel→canonical stream resolve와 primary head 검증
- slice-local Kysely conditional upsert
- effective cursor와 `advanced/unchanged` 결과
- module facade와 fake dependency 기반 provider tests

**완료 조건**

- 권한 확인 전에 stream/cursor query를 실행하지 않는다.
- 빈 readable channel의 `mark(0)`이 row 없이 `unchanged(0)`이다.
- head 초과를 clamp하지 않고 `invalid_cursor`로 거절한다.
- 낮거나 같은 요청이 row와 `updated_at`을 바꾸지 않는다.
- 100/120 동시 요청의 최종값이 실제 PostgreSQL에서 120이다.
- transaction 실패가 cursor를 부분 변경하지 않는다.
- message, stream head, 다른 사용자의 cursor를 수정하지 않는다.

**비범위**

- production auth/channel adapter
- HTTP/WS route
- read-state Query

권장 브랜치 slug: `mark-read-cursor`
