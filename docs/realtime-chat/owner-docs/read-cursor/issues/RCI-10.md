# RCI-10 Web Read Cursor transport 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-07](./RCI-07.md)
- [RCI-08](./RCI-08.md)
- [RCI-09](./RCI-09.md)
- [SMI-15 Web Stream Messages transport](../../stream-messages/issues/SMI-15.md)
- [SMI-22 Web authenticated realtime session](../../stream-messages/issues/SMI-22.md)

### 관련 설계

- [입출력과 transport](../design/06-contracts-and-transport.md)
- [Unread와 client state](../design/07-unread-and-client-state.md)

## 작업 정의

**목표**

실제 인증 session을 사용하는 read-state HTTP client와 mark WebSocket client를 chat transport에 추가한다.

**주요 변경**

- 화면 진입/reload read-state Query
- mark command 생성, correlation, accepted/rejected 처리
- pending intent debounce와 reconnect 처리
- connection generation/account change 시 stale result 폐기
- mock transport와 실제 transport 계약 정렬

**완료 조건**

- client가 actor/user ID를 전송하지 않는다.
- read-state 결과로 effective cursor와 `hasUnread`를 복구한다.
- mark accepted의 effective cursor가 local 상태를 역행시키지 않는다.
- retryable failure와 domain rejection을 다르게 처리한다.
- reconnect 뒤 pending intent를 현재 authenticated connection에서만 재평가한다.
- logout/account change가 이전 사용자 read state와 pending command를 폐기한다.
- transport contract test가 HTTP/WS fixture를 통과한다.

**비범위**

- UI lifecycle 판단
- same-user tab synchronization
- offline durable command queue

권장 브랜치 slug: `web-read-cursor-transport`
