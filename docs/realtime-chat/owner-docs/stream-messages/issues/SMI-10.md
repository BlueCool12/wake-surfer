# SMI-10 Latest·Older package-owned public HTTP adapter 조립

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-05](./SMI-05.md)
- [SMI-06](./SMI-06.md)
- [SMI-07](./SMI-07.md)
- [SMI-08](./SMI-08.md)
- [DEP-AUTH-01](./DEP-AUTH-01.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [03-load-latest.md](../design/03-load-latest.md)
- [05-load-older.md](../design/05-load-older.md)
- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-10. Latest·Older package-owned public HTTP adapter 조립

**목표**

인증된 browser actor가 channel latest/older Query를 HTTP로 호출하게 한다.

HTTP route registration, schema mapping, feature error mapping은
`@wake-surfer/realtime-chat-stream-messages`가 소유한다. API app은 HTTP server, actor 인증 함수, DB/runtime
dependency를 넘겨 register/mount만 한다.

**완료 조건**

- 확정 경로와 contracts parser를 사용한다.
- actor는 `DEP-AUTH-01`의 API auth context에서만 주입하며 body/query/header의 client-owned actor field를
  받지 않는다. production은 현재 개발용 평문 actor header adapter로 시작할 수 없다.
- concrete `ChannelReadAuthorizer`가 없으면 production app 조립이 실패하거나 route가 명시적으로 비활성이다.
- latest와 older가 각자의 Handler만 호출한다.
- API app에 Query DTO 변환, pagination, Kysely query, feature error code가 들어가지 않는다.
- package가 제공하는 public route registration을 app bootstrap이 한 번 mount한다.
- public HTTP mount가 latest/older canonical serializer로 만든 boundary별 `measureFinalEnvelope` 정책을 각
  Handler에 주입한다.
- contracts의 canonical serializer로 Handler가 측정한 동일 object를 전송하고 49,152 byte 이하인지
  adapter에서도 assertion한다. adapter가 별도 wrapper를 추가하지 않는다.
- domain rejection과 retryable failure를 다른 HTTP status/code로 응답한다.
- `x-request-id`를 response header와 body correlation에 유지한다.
- GET CORS, timeout, abort, readiness/drain 동작을 검증한다.
- API runtime contract를 갱신한다.

권장 브랜치 slug: `stream-messages-http-routes`

---
