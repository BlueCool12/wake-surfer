# SMI-16 Chat 화면에 latest·recovery·older 상태 연결

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-15](./SMI-15.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [03-load-latest.md](../design/03-load-latest.md)
- [05-load-older.md](../design/05-load-older.md)
- [07-realtime-and-client-merge.md](../design/07-realtime-and-client-merge.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-16. Chat 화면에 latest·recovery·older 상태 연결

**목표**

현재 chat 화면의 배열 교체 흐름을 sequence-aware model과 실제 transport로 교체한다.

**완료 조건**

- 기존 cursor가 있으면 recovery 후 안정 상태로 전환하고, 없으면 latest 5개로 시작한다.
- fake/live fixture가 merge model로 들어온 상태에서 history response가 기존 message를 덮어쓰지 않는다.
  production `chat.message.created` source 자체는 outbound-delivery 후속 capability다.
- 과거 더보기와 `hasMoreBefore = false` 종료 상태를 제공한다.
- loading, recovering, `recovery_pending`, retryable failure, `stream_unavailable`을 구분한다.
- channel 화면만 새 Query를 사용한다.
- 중복, 역순 삽입, 같은 message의 깜빡임이 없다.
- logout/account change가 저장 cursor를 폐기한다.
- Web build, state integration test, 접근성 검증이 통과한다.

권장 브랜치 slug: `chat-stream-messages-ui`

---
