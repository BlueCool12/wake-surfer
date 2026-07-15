# RCI-14 API–Gateway–PostgreSQL Read Cursor E2E 검증

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-02](./RCI-02.md)
- [RCI-06](./RCI-06.md)
- [RCI-07](./RCI-07.md)
- [RCI-08](./RCI-08.md)
- [SMI-03 PostgreSQL 통합 테스트 기반](../../stream-messages/issues/SMI-03.md)

### 관련 설계

- [Identity와 권한](../design/04-identity-and-authorization.md)
- [동시성과 멱등성](../design/05-concurrency-and-idempotency.md)
- [Acceptance criteria](../design/09-acceptance-and-non-goals.md)

## 작업 정의

**목표**

mock 경계를 넘어 실제 API, Gateway, PostgreSQL에서 Read Cursor 핵심 의미를 검증한다.

**필수 시나리오**

- insert, advance, same/lower no-op과 `updated_at` 불변
- 100/120 동시 요청의 최댓값 보존
- readable empty channel mark/read-state
- future sequence `invalid_cursor`
- 권한 거절 시 stream/cursor query 미실행
- 다른 사용자의 cursor 격리
- generic actor와 client actor spoof 차단
- Gateway service credential과 requester-only relay
- process abort/timeout/DB rollback
- read-state의 effective cursor와 `hasUnread`

**완료 조건**

- 실제 PostgreSQL과 실제 HTTP/WS server를 사용한다.
- 테스트 권한/identity provider가 allow/deny/failure/non-human을 명시적으로 제어한다.
- process 종료 뒤 열린 handle이 없다.
- 한 명령으로 반복 재현된다.
- 실패 로그에 사용자 identity 원문과 channel 내부 상태가 과도하게 노출되지 않는다.

**비범위**

- Web browser UI
- 대규모 부하 시험

권장 브랜치 slug: `read-cursor-e2e`
