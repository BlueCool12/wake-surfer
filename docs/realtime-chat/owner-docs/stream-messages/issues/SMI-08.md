# SMI-08 Older Stream Messages Query 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-07](./SMI-07.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [05-load-older.md](../design/05-load-older.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-08. Older Stream Messages Query 구현

**목표**

현재 history window보다 가까운 과거 page를 독립 Query/Handler로 조회한다.

**완료 조건**

- `beforeSequence`는 exclusive이며 `1 <= value <= headSequence + 1`만 허용한다.
- 기본 50, 최대 100이며 N+1 row로 `hasMoreBefore`를 판정한다.
- DB에서는 가까운 과거부터 내림차순으로 선택해도 외부 응답은 오름차순이다.
- 48KiB 상한에서는 `beforeSequence`에 가장 가까운 연속 구간만 반환한다.
- Handler는 주입된 `measureFinalEnvelope(candidate)` 크기 정책으로 candidate envelope을 측정하며 HTTP
  serializer를 직접 알지 않는다.
- non-empty `nextBeforeSequence`는 가장 오래된 반환 sequence이고 empty면 `null`이다.
- `headSequence + 1` 요청이 latest와 겹쳐도 정상이며 client merge가 중복을 제거할 수 있다.
- non-empty page 내부 sequence는 연속이고 가장 최신 row는 `beforeSequence - 1`이어야 한다. 마지막 page가
  1에 도달하지 않은 채 `hasMoreBefore = false`가 되면 current no-retention gap으로 실패한다.
- concurrent append가 기존 older 범위를 바꾸지 않는다.
- delivery cursor와 ReadCursor를 수정하지 않는다.
- 실제 PostgreSQL count/byte/cursor 경계 테스트가 있다.

권장 브랜치 slug: `load-older-stream-messages`

---
