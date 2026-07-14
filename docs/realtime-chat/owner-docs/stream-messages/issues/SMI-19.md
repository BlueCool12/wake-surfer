# SMI-19 Stream Messages 관측성과 운영 계약 마감

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-16](./SMI-16.md)
- [SMI-17](./SMI-17.md)
- [SMI-18](./SMI-18.md)
- [SMI-25](./SMI-25.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [11-acceptance-and-non-goals.md](../design/11-acceptance-and-non-goals.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-19. Stream Messages 관측성과 운영 계약 마감

**목표**

운영 중 느린 조회, 반복 recovery, cursor 오류, 데이터 무결성 문제를 content 노출 없이 진단하고 실제
consumer 문서를 최종 상태로 맞춘다.

**완료 조건**

- 구조화 로그에 query 종류, requestId, duration, message count, serialized byte, hasMore를 기록한다.
- sync relay의 domain rejection, timeout, network/5xx, schema mismatch를 구분한다.
- recovery 묶음의 completed, pending, cancelled, no-progress 상태를 기록한다.
- gap, oversized row, stream target mismatch는 ID/sequence/byte만 기록하고 content는 남기지 않는다.
- actor ID를 metric label로 쓰지 않고 ticket 원문과 asserted actor header를 로그에 남기지 않는다.
- provider README, API/Gateway runtime contract, Web feature 문서를 실제 구현과 일치시킨다.
- gap/oversized/target mismatch 발견 시 운영 대응 절차를 문서화한다.
- metrics backend가 아직 없으므로 대시보드 구축은 요구하지 않되 재사용할 안정적인 event/field 이름을
  고정한다.

권장 브랜치 slug: `stream-messages-operations`

---
