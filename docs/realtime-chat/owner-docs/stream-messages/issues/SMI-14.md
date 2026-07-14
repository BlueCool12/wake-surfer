# SMI-14 Web cursor 영속화와 제한된 자동 recovery 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-13](./SMI-13.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [04-sync-after.md](../design/04-sync-after.md)
- [07-realtime-and-client-merge.md](../design/07-realtime-and-client-merge.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-14. Web cursor 영속화와 제한된 자동 recovery 구현

**목표**

WebSocket reconnect와 browser reload 뒤에도 마지막 연속 cursor부터 안전하게 복구한다.

**확정 저장 규칙**

- `sessionStorage` key는 actor ID와 channel ID를 기본으로 한다.
- 안정적인 auth session namespace가 있으면 추가할 수 있지만 Gateway session ID는 사용하지 않는다.
- message content는 저장하지 않는다.
- `deliverySyncCursor`, 진행 중 `throughSequence`, recovery 상태만 저장한다.
- logout·계정 전환 때 이전 actor namespace를 폐기한다.

**완료 조건**

- `deliverySyncCursor`, `historyBeforeCursor`, ReadCursor를 다른 상태로 유지한다.
- 신뢰 가능한 cursor가 있으면 latest를 호출하기 전에 sync-after를 수행한다.
- cursor가 없을 때만 latest checkpoint를 만든다.
- 한 자동 묶음은 성공 page 10개, message 500개, 누적 serialized response 512KiB 중 먼저 도달한
  상한에서 `recovery_pending`으로 전환한다.
- 누적 byte는 transport가 raw HTTP response/WebSocket frame에서 측정해 전달한 값을 사용하고 parsed
  object를 다시 직렬화해 추정하지 않는다.
- 마지막 완전 적용 cursor와 같은 watermark를 저장하고 event loop에 양보한 뒤 새 묶음을 자동 시작한다.
- 실패·부분 page는 cursor와 누적량을 전진시키지 않는다.
- `hasMoreAfter = true`인데 cursor가 전진하지 않으면 protocol failure로 중단한다.
- `invalid_cursor`를 받았다고 자동 latest로 이동하지 않는다. 누락 구간을 포기하는 명시적 사용자 reset만
  latest checkpoint를 새로 만든다.
- `rate_limited`는 `retryAfterMs` 뒤 같은 cursor/watermark에서 재개하고 cursor를 전진시키지 않는다.
- reload, reconnect, cancel, retry를 fake transport와 새 store instance로 검증한다.

권장 브랜치 slug: `chat-cursor-recovery`

---
