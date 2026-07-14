# SMI-06 API 공통 오류·CORS·timeout 경계 일반화

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-02](./SMI-02.md)

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-06. API 공통 오류·CORS·timeout 경계 일반화

**목표**

gateway-ticket 전용 오류 변환을 feature-neutral API 경계로 바꾸고 stream query가 독립된 외부 의미를
유지하게 한다.

**완료 조건**

- handler timeout과 unknown 5xx가 항상 `gateway_ticket_unavailable`로 바뀌지 않는다.
- feature handler가 자신의 domain rejection code를 보존한다.
- auth failure, bad request, domain rejection, timeout, DB/network failure를 구분한다.
- browser CORS가 허용 origin에 대해 `GET`을 지원한다.
- 기존 ticket endpoint의 status/error 의미가 회귀하지 않는다.
- 공통 error envelope과 feature code의 소유권을 분리한다.
- API runtime contract와 관련 테스트를 갱신한다.

권장 브랜치 slug: `realtime-chat-api-error-boundary`

---
