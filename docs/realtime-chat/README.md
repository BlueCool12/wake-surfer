실시간 채팅 새 설계 세계의 탐색 그래프.

# Realtime Chat Design Graph

`docs/realtime-chat`는 현재 구현 문서와 독립된 새 설계 세계다. 이 디렉터리의 원천 자료는
[domain-event-storming-report.md](domain-event-storming-report.md)이고, 아래 문서들은 그
리포트를 구현 가능한 dependency graph로 분해한다.

## Graph

| Node | Use when | File |
| --- | --- | --- |
| Overview | 책임 경계와 source of truth를 먼저 확인한다. | [overview.md](overview.md) |
| Architecture router | 구현 target, logical partition, 외부 context edge를 찾는다. | [architecture.md](architecture.md) |
| API and event contract | command, event, response, read API shape를 확인한다. | [api.md](api.md) |
| Usage flows | 접속, 메시지 전송, 읽음, sync 흐름을 따라간다. | [usage.md](usage.md) |
| Constraints and blast radius | 변경 전에 consumer와 깨지면 안 되는 불변식을 본다. | [constraints.md](constraints.md) |
| Internals and decisions | 최종 결정과 후보를 버린 이유를 확인한다. | [internals.md](internals.md) |
| Testing | MVP acceptance scenario와 정합성 테스트를 찾는다. | [testing.md](testing.md) |
| Event storming breakdown | bounded context, aggregate, command/event를 한 번에 본다. | [event-storming-breakdown.md](event-storming-breakdown.md) |

## Current Status

이 graph는 설계 문서 graph다. 아직 이 세계에 1:1로 대응하는 code edge는 없다.
구현이 시작되면 [architecture.md](architecture.md)의 target path를 실제 파일로 바꾸고,
non-obvious contract에는 code -> doc anchor를 추가한다.
