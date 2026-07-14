# SMI-21 Gateway 인증 완료 event와 pre-ready 차단 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- 없음

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-21. Gateway 인증 완료 event와 pre-ready 차단 구현

**목표**

client가 ticket consume과 local session 등록 완료 시점을 명확히 알게 하고 그 전에는 application event를
보낼 수 없게 한다.

**완료 조건**

- ticket consume 성공과 local session 등록이 모두 끝난 뒤 한 번만 `gateway.connected`를 보낸다.
- event는 protocol version, connection generation, gateway/session 식별자, connected time을 표현하되
  actor credential은 포함하지 않는다.
- ready 이전 client application event는 queue하지 않고 `gateway.not_ready`로 거절하거나 socket을 닫는다.
- ticket rejected connection은 `gateway.connected`를 보내지 않는다.
- 재접속은 새로운 connection generation을 가지며 이전 socket의 늦은 event를 식별할 수 있다.
- event schema와 mapping은 gateway ticket/session package가 소유하고 Gateway app은 mount만 한다.
- Gateway runtime contract와 connect/reject/close 테스트를 갱신한다.

권장 브랜치 slug: `gateway-connected-event`

---
