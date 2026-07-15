# RCI-11 Chat 화면 읽음 lifecycle 연결

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-10](./RCI-10.md)
- [SMI-16 Chat 화면 Stream Messages 연결](../../stream-messages/issues/SMI-16.md)

### 관련 설계

- [Mark 의미](../design/03-mark-semantics.md)
- [Unread와 client state](../design/07-unread-and-client-state.md)
- [Acceptance criteria](../design/09-acceptance-and-non-goals.md)

## 작업 정의

**목표**

Chat 화면의 활성 channel, visibility, Stream Messages merge/render, sender accepted lifecycle을 read observation과
transport에 연결한다.

**주요 변경**

- channel 진입/reload 시 read-state 복구
- latest render 완료 뒤 baseline mark
- live/sync gap 없는 연속 위치 mark
- sender accepted/render 뒤 mark
- `hasUnread` badge와 loading/error 상태
- channel 전환, hidden/visible, unmount cleanup

**완료 조건**

- background/inactive channel 수신만으로 mark하지 않는다.
- latest render 전에는 mark하지 않고 render 뒤 head까지 mark한다.
- delayed live와 sync merge가 message를 잃거나 cursor를 건너뛰지 않는다.
- 자기 메시지도 mark 전에는 `hasUnread` 원인이 될 수 있다.
- cursor 일부 전진만으로 head가 남아 있으면 badge를 지우지 않는다.
- 같은 사용자 다른 탭에 직접 fan-out하지 않는다.
- browser behavior test가 active/hidden/channel switch/sender 흐름을 검증한다.

**비범위**

- viewport intersection tracking
- exact unread count
- inbox badge

권장 브랜치 slug: `chat-read-cursor-lifecycle`
