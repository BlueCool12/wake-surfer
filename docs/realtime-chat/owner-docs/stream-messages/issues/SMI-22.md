# SMI-22 Web authenticated realtime session bootstrap 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-21](./SMI-21.md)
- [DEP-AUTH-01](./DEP-AUTH-01.md)

### 필요한 공개 계약

- [Stream Messages recovery](../../../public-docs/stream-messages/recovery.md)

### 관련 설계

- [07-realtime-and-client-merge.md](../design/07-realtime-and-client-merge.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-22. Web authenticated realtime session bootstrap 구현

**목표**

인증된 Web actor가 ticket을 발급받아 WebSocket을 연결하고 `gateway.connected` 이후에만 feature transport를
사용하게 한다.

**완료 조건**

- `DEP-AUTH-01` actor session으로 gateway ticket을 요청한다.
- ticket의 gateway URL로 연결하고 `gateway.connected`를 기다린 뒤 ready 상태가 된다.
- timeout, ticket rejection, socket close를 구분한다.
- 재접속마다 새 ticket을 발급받고 exponential backoff와 최대 즉시 retry 횟수를 적용한다.
- connection generation이 바뀌면 이전 socket의 response/event를 폐기한다.
- 한 authenticated realtime session이 여러 channel stream transport를 공유한다.
- route unmount는 channel 구독만 정리하고 logout/session end가 socket과 actor-scoped cursor를 정리한다.
- fake socket과 실제 Gateway connect test가 있다.

권장 브랜치 slug: `web-realtime-session`

---
