# RCI-01 Read Cursor 공개 계약 정의

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-01 공통 message 계약과 stream identity](../../stream-messages/issues/SMI-01.md)

### 관련 설계

- [Slice와 aggregate](../design/02-slice-and-aggregate.md)
- [입출력과 transport](../design/06-contracts-and-transport.md)
- [Domain Owner 결정](../design/08-domain-owner-decisions.md)

## 작업 정의

**목표**

`@wake-surfer/realtime-chat-read-cursor-contracts`를 만들고 mark Command와 read-state Query의 외부 경계를
strict runtime schema로 고정한다.

**주요 변경**

- client WebSocket mark request/result/rejection 계약
- Gateway→API internal mark request/result 계약
- public HTTP read-state request/result 계약
- 공통 correlation, channel selector, cursor, public error 의미
- package README와 public export 경계

**확정 구현 규칙**

- 세 transport DTO를 slice-local Command/Query와 공유하지 않는다.
- client payload에 actor/user/role/membership 필드를 허용하지 않는다.
- mark 성공은 effective cursor와 `advanced/unchanged`를 가진다.
- read-state 성공은 effective cursor와 `hasUnread`를 가진다.
- `stream_unavailable`, `invalid_cursor`, retryable failure를 구분한다.
- canonical stream ID와 ID primitive는 `SMI-01` 결과를 재정의하지 않는다.

**완료 조건**

- 잘못된 sequence와 unknown field를 거절하는 schema test가 있다.
- mark/read-state/내부 relay fixture가 독립적으로 round-trip된다.
- contracts package가 구현 package, DB, server framework에 의존하지 않는다.
- README가 client contract와 internal process contract를 구분한다.

**비범위**

- Handler와 DB
- HTTP/WS server registration
- unread count

권장 브랜치 slug: `read-cursor-contracts`
