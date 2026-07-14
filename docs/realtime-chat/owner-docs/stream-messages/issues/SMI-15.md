# SMI-15 Web 실제 Stream Messages transport 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-10](./SMI-10.md)
- [SMI-12](./SMI-12.md)
- [SMI-14](./SMI-14.md)
- [SMI-22](./SMI-22.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [04-sync-after.md](../design/04-sync-after.md)
- [07-realtime-and-client-merge.md](../design/07-realtime-and-client-merge.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-15. Web 실제 Stream Messages transport 구현

**목표**

mock `loadHistory()` 대신 실제 HTTP/WS Query 계약을 소비한다.

**완료 조건**

- transport interface를 latest, older, sync-after 전용 메서드로 분리한다.
- latest/older는 HTTP, sync-after는 WebSocket relay를 사용한다.
- `SMI-22`의 authenticated realtime session이 `gateway.connected` ready 상태일 때만 sync event를 보낸다.
- 모든 success/error payload를 공유 runtime schema로 parse한다.
- HTTP raw text와 WebSocket raw frame의 UTF-8 byte 수를 parse 전에 측정하고 검증된 result와 함께 recovery
  orchestrator에 전달한다.
- HTTP `x-request-id`와 WebSocket `requestId` correlation을 보존한다.
- timeout, abort, stale response, socket close를 처리한다.
- domain rejection과 retryable failure를 UI가 구분할 수 있는 결과로 전달한다.
- mock transport는 명시적인 개발/테스트 구현으로만 남는다.
- message-send와 outbound delivery 구현을 이 이슈에 포함하지 않는다.

권장 브랜치 slug: `web-stream-messages-transport`

---
