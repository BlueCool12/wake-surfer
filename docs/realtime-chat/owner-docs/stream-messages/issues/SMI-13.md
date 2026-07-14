# SMI-13 Web sequence-aware message merge model 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-01](./SMI-01.md)
- [SMI-02](./SMI-02.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [07-realtime-and-client-merge.md](../design/07-realtime-and-client-merge.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-13. Web sequence-aware message merge model 구현

**목표**

latest, older, sync, live created, sender accepted를 하나의 순수 상태 모델로 병합한다.

**완료 조건**

- canonical key는 `streamId + sequence`이며 `messageId`도 교차 검증한다.
- same sequence/different message와 same message/different sequence를 계약 위반으로 검출한다.
- latest response가 먼저 도착한 live message를 배열 교체로 잃지 않는다.
- out-of-order live message를 buffer하고 gap sync 필요 상태를 만든다.
- sync가 gap을 채우면 순서대로 한 번만 적용한다.
- cursor 이하이면서 loaded window 밖인 delayed event는 current tail에 삽입하지 않는다.
- older merge는 `deliverySyncCursor`를 바꾸지 않는다.
- channel stream에 thread target message가 들어오면 계약 위반으로 검출한다.
- root message에 `threadSummary`가 없어도 정상이다.
- reducer/store 단위 테스트가 transport 없이 실행된다.

권장 브랜치 slug: `chat-message-merge-model`

---
