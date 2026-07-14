# SMI-09 Sync-after Stream Messages Query 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-07](./SMI-07.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [04-sync-after.md](../design/04-sync-after.md)
- [09-performance-and-payload.md](../design/09-performance-and-payload.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-09. Sync-after Stream Messages Query 구현

**목표**

고정 watermark까지 누락 구간을 한 page씩 복구하는 독립 Query/Handler를 구현한다.

**완료 조건**

- 첫 page는 현재 committed head를 `throughSequence`로 고정한다.
- 후속 page는 `afterSequence < sequence <= throughSequence`만 읽는다.
- 각 page 시작 시 authorization을 다시 수행한다.
- 기본 50, 최대 100, N+1과 48KiB를 함께 적용한다.
- Handler는 주입된 `measureFinalEnvelope(candidate)` 크기 정책으로 candidate envelope을 측정하며 WebSocket
  serializer를 직접 알지 않는다. internal HTTP response가 더 작다는 이유로 page를 늘리지 않는다.
- non-empty `nextAfterSequence`는 마지막 반환 sequence다.
- empty final page의 `nextAfterSequence`는 `throughSequence`이며 `hasMoreAfter = false`다.
- final page의 cursor가 watermark에 정확히 도달한다.
- `afterSequence > head`, 변조된 watermark, stream target mismatch, gap을 확정된 오류 범주로 처리한다.
- page 사이 concurrent append를 현재 snapshot에 포함하지 않는다.
- 실제 PostgreSQL 다중 page/concurrent append 테스트가 있다.

권장 브랜치 slug: `sync-stream-messages-after`

---
