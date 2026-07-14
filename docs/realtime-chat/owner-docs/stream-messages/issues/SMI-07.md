# SMI-07 Latest Stream Messages Query 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-01](./SMI-01.md)
- [SMI-03](./SMI-03.md)
- [SMI-04](./SMI-04.md)
- [SMI-24](./SMI-24.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [03-load-latest.md](../design/03-load-latest.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-07. Latest Stream Messages Query 구현

**목표**

`@wake-surfer/realtime-chat-stream-messages` package의 read-only 기반과 latest Query/Handler를 구현한다.

**주요 변경**

- provider package와 `ChannelReadAuthorizer` consumer contract
- `@wake-surfer/realtime-chat-message-send/table-contract`의 read-only DB type 사용
- channel target → canonical stream identity resolve
- latest slice-local Kysely query, mapper, byte-aware page policy

**완료 조건**

- 독립 Query input/output과 Handler를 가진다.
- authorization 전에 message row/content를 조회하지 않는다.
- 빈 channel은 DB row를 만들지 않고 `streamId = channel:{channelId}`, `throughSequence = 0`, 빈 page로
  성공한다.
- non-empty stream은 현재 head 기준 최근 6개까지 선택해 최대 5개를 오름차순으로 반환한다.
- Handler는 주입된 `measureFinalEnvelope(candidate)` 크기 정책으로 candidate envelope을 측정하며 HTTP
  serializer를 직접 알지 않는다.
- 48KiB 때문에 줄일 때는 head를 포함한 가장 가까운 연속 tail만 남긴다.
- `nextBeforeSequence`와 `hasMoreBefore`가 count/byte trimming을 모두 반영한다.
- head 한 건만으로 48KiB를 넘으면 skip/truncate하지 않고 data-integrity failure로 중단한다.
- stream row target mismatch와 current no-retention gap을 data-integrity failure로 검출한다.
- Query가 message, stream, read cursor를 수정하지 않는다.
- 실제 PostgreSQL snapshot/concurrent append 테스트가 있다.

**의존성 메모**

concrete channel provider가 준비되기 전에는 fake authorizer로 provider 테스트만 수행한다.

권장 브랜치 slug: `load-latest-stream-messages`

---
