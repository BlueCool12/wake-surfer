# SMI-05 ChannelReadAuthorizer adapter 연결

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [DEP-CH-01](./DEP-CH-01.md)
- [SMI-07](./SMI-07.md)

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [06-target-scope-and-selector.md](../design/06-target-scope-and-selector.md)
- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-05. ChannelReadAuthorizer adapter 연결

**목표**

`DEP-CH-01`의 실제 channel provider를 Stream Messages의 `ChannelReadAuthorizer` consumer contract에
번역한다.

**소유권**

- stream-messages는 좁은 consumer contract인 `ChannelReadAuthorizer`를 소유한다.
- channel 존재와 membership 기준 상태 및 concrete provider는 channel bounded context가 소유한다.
- 이 이슈는 `SMI-07`에서 consumer contract가 생성되고 `DEP-CH-01` provider가 준비된 뒤 시작한다.
- fake provider만 추가해서 닫을 수 없다.

**완료 조건**

- 입력 actor는 server auth context에서만 온다.
- 존재하지 않는 channel과 읽기 권한이 없는 channel은 모두 `stream_unavailable`로 보인다.
- 허용된 actor에는 minimum readable sequence를 반환하지 않으며 저장된 전체 history를 읽게 한다.
- message content query보다 먼저 판정된다.
- app production 조립에 allow-all 또는 allow-if-unknown fallback이 없다.
- provider 장애는 권한 거절이 아니라 retryable infrastructure failure다.
- 권한 철회 race는 page 시작 시 판정하고 다음 page에서 다시 판정하는 Accepted 규칙을 따른다.

**출시 조건**

이 이슈가 완료되지 않으면 `SMI-10`, `SMI-11` route를 production에 mount하지 않는다.

권장 브랜치 slug: `channel-read-authorizer`

---
