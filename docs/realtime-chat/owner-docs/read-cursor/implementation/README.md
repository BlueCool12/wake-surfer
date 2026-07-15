# Read Cursor 구현 이슈 문서

이 디렉터리는 구현 owner가 전체 계획을 읽지 않고 자기 이슈 문서와 직접 선행 이슈만 읽도록 분할한 실행
문서다. `RCI-*`는 계획 식별자이며 아직 GitHub 이슈 번호가 아니다.

## 공통 실행 문서

- [계획 역할과 고정 결정](./00-role-and-fixed-decisions.md)
- [저장소 선행 위험](./01-repository-risks.md)
- [의존성 그래프](./02-dependency-graph.md)
- [이슈 카탈로그](./03-issue-catalog.md)
- [병렬 실행 계획](./04-execution-waves.md)
- [출시 관문과 후속 capability](./05-release-gates-and-followups.md)
- [GitHub 이슈 생성 규칙](./06-github-issue-rules.md)
- [구현 순서 가이드](./07-implementation-order-guide.md)

## 내부 이슈

- [RCI-01 Read Cursor 공개 계약 정의](../issues/RCI-01.md)
- [RCI-02 Read Cursor table contract와 database migration 합성](../issues/RCI-02.md)
- [RCI-03 Mark Read Cursor Command 구현](../issues/RCI-03.md)
- [RCI-04 Get Channel Read State Query 구현](../issues/RCI-04.md)
- [RCI-05 사람 identity·channel authorization production adapter 연결](../issues/RCI-05.md)
- [RCI-06 Package-owned internal mark API 구현](../issues/RCI-06.md)
- [RCI-07 Package-owned public read-state HTTP API 구현](../issues/RCI-07.md)
- [RCI-08 Gateway WebSocket mark relay 구현](../issues/RCI-08.md)
- [RCI-09 Web read observation 상태 모델 구현](../issues/RCI-09.md)
- [RCI-10 Web Read Cursor transport 구현](../issues/RCI-10.md)
- [RCI-11 Chat 화면 읽음 lifecycle 연결](../issues/RCI-11.md)
- [RCI-12 Read Cursor 분산 rate limit 구현](../issues/RCI-12.md)
- [RCI-13 생산자·소비자 계약 적합성 검증](../issues/RCI-13.md)
- [RCI-14 API–Gateway–PostgreSQL Read Cursor E2E 검증](../issues/RCI-14.md)
- [RCI-15 관측성·운영 계약·공개 문서 마감](../issues/RCI-15.md)

## 공유 선행 이슈

별도 Read Cursor 이슈로 복제하지 않고 Stream Messages 계획의 결과를 소비한다.

- [DEP-AUTH-01 인증 actor session과 trusted edge](../../stream-messages/issues/DEP-AUTH-01.md)
- [DEP-CH-01 channel 기준 상태](../../stream-messages/issues/DEP-CH-01.md)
- [Stream Messages 이슈 index](../../stream-messages/implementation/README.md)

## 작업 규칙

1. 자기 이슈 문서의 `Read first`만 먼저 읽는다.
2. 직접 선행 이슈가 완료되지 않았으면 그 이슈의 공개 결과만 확인한다.
3. 더 깊은 근거가 필요할 때만 [설계 index](../design/README.md)로 이동한다.
4. `notes/`는 사람용 archive이며 agent 기본 context가 아니다.
