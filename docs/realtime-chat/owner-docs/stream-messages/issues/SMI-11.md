# SMI-11 Package-owned internal sync API와 Gateway actor assertion 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-05](./SMI-05.md)
- [SMI-06](./SMI-06.md)
- [SMI-09](./SMI-09.md)
- [SMI-20](./SMI-20.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [04-sync-after.md](../design/04-sync-after.md)
- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-11. Package-owned internal sync API와 Gateway actor assertion 구현

**목표**

Gateway가 local session actor를 대신해 한 page의 sync-after를 API에 요청할 수 있는 trusted internal 경계를
만든다.

internal route와 feature-specific Gateway API client는 stream-messages package가 소유한다. API/Gateway app은
base URL, trusted header 이름, 인증 함수, fetch/runtime resource를 주입하고 mount만 한다.

**확정 인증 방식**

- `SMI-20`의 Gateway service bearer credential을 먼저 검증한다.
- `x-gateway-id`는 식별자로만 사용하고 credential로 사용하지 않는다.
- service 인증 성공 뒤에만 별도 server-only actor header를 읽는다.
- actor는 request body에 포함하지 않는다.
- public route는 asserted actor header를 해석하지 않는다.

**완료 조건**

- internal route가 sync-after Handler만 호출한다.
- internal sync mount가 최종 `chat.stream.synced` canonical serializer로 만든 `measureFinalEnvelope` 정책을
  Handler에 주입한다. internal HTTP envelope이 더 작아도 page를 늘리지 않는다.
- API app에 sync request/response mapping이나 actor assertion 해석을 직접 구현하지 않는다.
- Gateway app에 feature response type guard를 직접 구현하지 않는다.
- Gateway 인증 실패와 actor assertion 누락/오염을 거절한다.
- 같은 WebSocket request의 `requestId`를 `x-request-id`로 보존한다.
- Gateway API client는 timeout, abort, non-2xx, invalid JSON, schema mismatch를 구분한다.
- 5xx/transport failure를 `stream_unavailable` 같은 domain rejection으로 위장하지 않는다.
- 로그에 asserted actor header 원문이나 message content를 남기지 않는다.
- API와 Gateway runtime contract에 trusted ingress 배포 조건을 기록한다.

권장 브랜치 slug: `stream-sync-internal-api`

---
