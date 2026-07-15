# Read Cursor 설계 문서

이 디렉터리는 Read Cursor 구현 owner가 담당 이슈에 필요한 설계만 선택해 읽도록 분할한 기준 문서다.
구현자는 자기 이슈의 `Read first`와 [Domain Owner 결정](./08-domain-owner-decisions.md),
[Acceptance criteria](./09-acceptance-and-non-goals.md)만 우선 읽는다.

## 설계 문서

- [문서 역할과 근거](./00-role-and-evidence.md)
- [결론 요약과 현재 저장소](./01-summary-and-current-state.md)
- [Slice와 aggregate 경계](./02-slice-and-aggregate.md)
- [Mark 의미와 client 발행 조건](./03-mark-semantics.md)
- [Identity, 권한, 정보 은닉](./04-identity-and-authorization.md)
- [트랜잭션, 동시성, 멱등성](./05-concurrency-and-idempotency.md)
- [입출력, 실패, transport](./06-contracts-and-transport.md)
- [Unread와 client read state](./07-unread-and-client-state.md)
- [Domain Owner 결정](./08-domain-owner-decisions.md)
- [Acceptance criteria와 비범위](./09-acceptance-and-non-goals.md)

## 이슈 작업

구현 이슈의 목표·완료 조건·선행 이슈는 [이슈 index](../implementation/README.md)와 `../issues/`를
사용한다.
