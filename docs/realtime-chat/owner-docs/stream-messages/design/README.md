# Stream Messages 설계 문서

이 디렉터리는 Stream Messages 구현 owner가 필요한 설계만 선택해 읽도록 분할한 기준 문서다. query 구현자는 담당 Query 파일과 [결정](./10-domain-owner-decisions.md), [acceptance criteria](./11-acceptance-and-non-goals.md)만 읽으면 된다.

## 설계 문서

- [문서 역할과 근거](./00-role-and-evidence.md)
- [결론 요약과 현재 구현](./01-summary-and-current-state.md)
- [Slice와 cursor 모델](./02-slice-and-cursor-model.md)
- [Latest Query](./03-load-latest.md)
- [Sync-after Query](./04-sync-after.md)
- [Older Query](./05-load-older.md)
- [Target 범위와 stream selector](./06-target-scope-and-selector.md)
- [실시간 수신과 client merge](./07-realtime-and-client-merge.md)
- [권한, 계약, transport](./08-authorization-contracts-and-transport.md)
- [성능, snapshot, payload](./09-performance-and-payload.md)
- [Domain Owner 결정](./10-domain-owner-decisions.md)
- [Acceptance criteria와 비범위](./11-acceptance-and-non-goals.md)

## 이슈 작업

구현 이슈의 목표·완료 조건·선행 이슈는 [이슈 index](../implementation/README.md)와 ../issues/를 사용한다.
