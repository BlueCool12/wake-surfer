# DEP-CH-01 Channel 기준 상태와 읽기 권한 모델 제공

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

- [고정 결정](../implementation/00-role-and-fixed-decisions.md)
- [저장소 선행 위험](../implementation/01-repository-risks.md)
- [Stream Messages 공개 API](../../../public-docs/stream-messages/api.md)

## 작업 정의

**Owner**: channel/workspace bounded context

**필수 결과**

- channel 존재, visibility, workspace/channel membership의 authoritative source가 있다.
- public channel은 active workspace member, private channel은 active channel member가 읽을 수 있다는 최소
  규칙을 제공한다.
- archived channel은 위 membership을 유지한 actor에게 read-only history 조회를 허용한다.
- 입력 `actorId + channelId`에 대해 available/unavailable/infrastructure failure를 구분하는 public provider
  contract가 있다.
- fake나 allow-all이 아닌 production provider와 통합 테스트가 있다.

이 결과가 준비되면 `SMI-05`가 Stream Messages의 `ChannelReadAuthorizer` consumer contract로 번역한다.
