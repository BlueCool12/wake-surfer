# SMI-20 Gateway service credential 인증 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- 없음

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-20. Gateway service credential 인증 구현

**목표**

평문 `x-gateway-id` 신뢰를 제거하고 API internal route가 실제 Gateway service를 인증하게 한다.

**확정 방식**

- API와 Gateway가 최소 32 random byte의 `REALTIME_CHAT_GATEWAY_API_TOKEN`을 공유한다.
- Gateway는 TLS internal HTTP 요청의 `Authorization: Bearer ...`로 credential을 보낸다.
- API는 timing-safe 비교로 검증하고, 성공한 뒤에만 gateway ID와 asserted actor header를 읽는다.
- `x-gateway-id`는 관측/할당 식별자이며 credential이 아니다.
- production에서는 token 미설정 시 startup을 실패시킨다. transport는 TLS를 사용하거나 runtime이
  service-mesh TLS 종단을 명시적으로 증명해야 하며, 둘 다 아니면 startup을 실패시킨다.

**완료 조건**

- token 없음, 잘못된 token, 빈 actor assertion, public route의 actor assertion을 모두 거절한다.
- credential, actor assertion 원문, ticket을 로그에 남기지 않는다.
- Gateway API client가 모든 internal request에 credential을 넣는다.
- 기존 ticket consume과 새 sync-after가 같은 service auth middleware를 사용한다.
- API/Gateway runtime contract와 secret rotation 절차를 문서화한다.

권장 브랜치 slug: `gateway-service-auth`

---
