# RCI-04 Get Channel Read State Query 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-01](./RCI-01.md)
- [RCI-02](./RCI-02.md)

### 관련 설계

- [Slice와 aggregate](../design/02-slice-and-aggregate.md)
- [Unread와 client state](../design/07-unread-and-client-state.md)
- [Acceptance criteria](../design/09-acceptance-and-non-goals.md)

## 작업 정의

**목표**

화면 진입/reload에서 서버 read state를 복구하는 독립 Query input/output과 Handler를 구현한다.

**주요 변경**

- human user/channel authorization consumer contract 사용
- canonical stream head와 cursor read-only query
- row 없음의 effective cursor 0 처리
- `hasUnread = head > effective cursor`
- 빈 readable channel의 cursor 0, `hasUnread = false`

**완료 조건**

- authorization 전에 stream/cursor를 조회하지 않는다.
- Query가 stream, message, cursor row를 만들거나 갱신하지 않는다.
- partial cursor advance 뒤에도 head가 크면 `hasUnread = true`다.
- 자기 메시지를 별도로 제외하지 않는다.
- 같은 snapshot을 보장하지 않는 head/cursor 경쟁을 안전한 현재 상태로 문서화하고 테스트한다.
- exact unread count 필드가 없다.

**비범위**

- inbox/channel list projection
- same-user device push
- public HTTP adapter

권장 브랜치 slug: `get-channel-read-state`
