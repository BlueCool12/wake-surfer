# Read Cursor 설계: Unread와 client read state

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## MVP unread

cursor가 source of truth이며 MVP는 boolean만 제공한다.

- row가 없으면 effective cursor는 0이다.
- `hasUnread = stream head > effective cursor`다.
- 정확한 `unreadCount`는 제공하지 않는다.

cursor가 일부 전진했다고 badge를 무조건 지우면 안 된다. head가 100이고 cursor가 50에서 70으로
전진했다면 `hasUnread`는 계속 true다.

## 자기 메시지

Handler는 자기 메시지를 특별 취급하지 않는다. 활성 sender 화면은 message accepted/render 뒤 mark를
보낸다. 다른 기기에서 보낸 자기 메시지나 비활성 화면에서 일시적으로 unread가 되는 것을 MVP에서
허용한다.

Message Send는 `read_cursors`를 직접 갱신하지 않는다. sender 제외 projection이나 자동 cursor 전진
event-handler도 만들지 않는다.

## 서버 상태 복구

화면 진입과 reload는 `get-channel-read-state` Query를 호출해 effective cursor와 `hasUnread`를 복구한다.
client local state는 여러 기기와 재설치에서 복구할 수 없으므로 source of truth가 아니다.

향후 channel/inbox read model이 생기면 이 값을 통합할 수 있지만 MVP는 별도 Query로 시작한다.

## 다중 탭·기기와 event

- mark 결과는 요청한 연결에만 반환한다.
- 같은 사용자의 다른 탭·기기에 즉시 push하지 않는다.
- 다른 사용자를 향한 read receipt broadcast를 하지 않는다.
- 현재 소비자 없는 `ReadCursorAdvanced` event를 발행하지 않는다.

향후 정확한 inbox projection이 필요하면 실제 cursor 전진과 같은 트랜잭션의 outbox를 사용한다. best-effort
broker event로 영속 projection을 갱신하지 않는다.

## Client 상태 소유

Web의 read observation model은 다음을 소유한다.

- active channel
- document/app visibility
- Stream Messages merge/render 완료 지점
- gap 없는 최대 연속 applied sequence
- 전송 대기 중인 가장 큰 mark sequence
- server가 응답한 effective cursor와 `hasUnread`

이 상태는 Stream Messages의 delivery/history cursor와 분리한다.
