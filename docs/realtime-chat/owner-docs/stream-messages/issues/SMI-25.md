# SMI-25 Stream query distributed rate limit 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-02](./SMI-02.md)
- [SMI-10](./SMI-10.md)
- [SMI-12](./SMI-12.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [09-performance-and-payload.md](../design/09-performance-and-payload.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-25. Stream query distributed rate limit 구현

**목표**

page/recovery 상한과 별개로 반복 HTTP/WS query가 API, Gateway, PostgreSQL을 고갈시키지 않게 한다.

**확정 초기 정책**

- public latest/older: actor당 분당 120회, source IP당 분당 300회
- WebSocket sync page: actor당 분당 120회, session+channel당 동시 1회
- 여러 API/Gateway instance가 같은 Redis 8.8 token bucket 상태를 사용한다.
- 상한은 env로 더 낮출 수 있지만 production에서 무제한으로 설정할 수 없다.

**완료 조건**

- HTTP는 `429`와 `rate_limited`, `retryAfterMs`/`Retry-After`를 반환한다.
- WebSocket은 `chat.stream.sync.rejected(rate_limited, retryAfterMs)`를 반환한다.
- source IP는 trusted edge가 확정한 connection context에서 받고 client가 임의 지정한 forwarding header를
  직접 신뢰하지 않는다.
- limiter key는 raw actor/IP를 로그에 노출하지 않는 namespaced digest를 사용한다.
- Redis 장애 시 query를 무제한 통과시키지 않고 retryable `stream_messages_unavailable`로 fail closed한다.
- app은 Redis lifecycle을 소유하고 package-owned adapter에 limiter runtime을 주입한다.
- 단일/다중 instance, 경계 시간, retry-after, Redis failure 테스트가 있다.

권장 브랜치 slug: `stream-query-rate-limit`
