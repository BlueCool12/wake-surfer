# SMI-12 Package-owned Gateway WebSocket sync relay 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-11](./SMI-11.md)
- [SMI-21](./SMI-21.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [04-sync-after.md](../design/04-sync-after.md)
- [07-realtime-and-client-merge.md](../design/07-realtime-and-client-merge.md)
- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-12. Package-owned Gateway WebSocket sync relay 구현

**목표**

인증된 socket session이 `chat.stream.sync` 한 page를 요청하고 correlation된 결과를 받게 한다.

WebSocket event parse/result mapping과 relay orchestration은 stream-messages package가 소유한다. Gateway app은
WebSocket server, local session lookup, API client runtime, logger를 넘겨 package registration을 mount한다.

**완료 조건**

- `SMI-21`의 `gateway.connected`가 전송되고 ready 상태가 되기 전 event를 처리하지 않는다.
- actor는 local session registry에서 가져오며 client payload의 actor/stream ID hint를 거절한다.
- strict event schema와 inbound payload 상한을 적용한다.
- client event 하나는 internal API page 요청 하나로 relay한다.
- `requestId`를 API 호출과 success/rejected/failed event에 보존한다.
- domain rejection은 `chat.stream.sync.rejected`, retryable transport failure는
  `chat.stream.sync.failed`로 구분한다.
- `rate_limited` rejection의 `retryAfterMs`를 보존한다.
- success event는 contracts의 canonical `chat.stream.synced` serializer로 만들며 추가 wrapper를 붙이지
  않는다.
- socket close 시 진행 중 request를 abort하고 늦은 response를 폐기한다.
- 같은 session/channel에서 중복 in-flight request를 허용하지 않는다.
- Gateway가 pagination, authorization, gap policy를 재구현하지 않는다.
- Gateway app bootstrap에 event payload schema나 sync result mapping을 직접 넣지 않는다.
- Gateway runtime contract와 relay 테스트를 갱신한다.

권장 브랜치 slug: `gateway-stream-sync-relay`

---
