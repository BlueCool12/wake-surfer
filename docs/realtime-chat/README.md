# realtime-chat 문서 진입점

이 디렉터리는 realtime-chat의 공개 계약, owner 전용 설계 문맥, 사람용 배경 기록을 분리한다.

## 어떤 문서를 읽어야 하는가

| 작업 | 먼저 읽을 문서 |
| --- | --- |
| 전체 아키텍처 이해 | [public architecture](./public-docs/architecture.md) |
| Stream Messages consumer 구현 | [query API](./public-docs/stream-messages/api.md), [invariants](./public-docs/stream-messages/invariants.md), [recovery](./public-docs/stream-messages/recovery.md) |
| Stream Messages 내부 구현 | [owner decisions](./owner-docs/stream-messages/decisions.md), [implementation map](./owner-docs/stream-messages/implementation-map.md) |
| Read Cursor 내부 설계 | [owner decisions](./owner-docs/read-cursor/decisions.md), [design index](./owner-docs/read-cursor/design/README.md) |
| Read Cursor 이슈 작업 | [implementation map](./owner-docs/read-cursor/implementation-map.md), [issue index](./owner-docs/read-cursor/implementation/README.md) |
| 과거 설계·flow 조사 | [notes archive](./notes/) |

## 문서 경계

`public-docs/`는 consumer가 읽어도 되는 외부 계약이다. `owner-docs/`는 해당 기능을 수정하는 owner가 읽는 내부 설계다. `notes/`는 현재 계약이 아니라 배경 기록이므로 agent context의 기본 진입점으로 사용하지 않는다.

Read Cursor 도메인 결정은 `Accepted`이며 구현 계획을 `RCI-01`~`RCI-15` 이슈 단위로 분할했다. 아직 구현과 공개 계약은 없으므로 consumer contract로 사용하지 않으며, 검증된 구현 계약만 `public-docs/` 또는 실제 provider package 문서로 승격한다.

## 기준 원문

세부 근거와 결정 이력은 [Stream Messages 유스케이스 설계](./notes/implementation-plans/stream-messages/stream-messages-use-case-design.md)와 [구현 계획](./notes/implementation-plans/stream-messages/stream-messages-implementation-plan.md)에 보관한다. 구현 중 계약을 바꿀 때는 먼저 owner 문서를 갱신하고, consumer-facing 변경이면 public 문서도 함께 갱신한다.
