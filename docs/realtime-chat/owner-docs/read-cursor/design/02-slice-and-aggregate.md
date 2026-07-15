# Read Cursor 설계: Slice와 aggregate 경계

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## 실제 vertical slice

`read-cursor`는 capability package이고 실제 구현 slice는 둘이다.

| Slice | 종류 | 하나의 처리 결과 |
| --- | --- | --- |
| `mark-read-cursor` | Command | cursor를 조건부 전진시키고 effective cursor와 `advanced/unchanged`를 반환한다. |
| `get-channel-read-state` | Query | effective cursor와 `hasUnread`를 읽어 반환한다. |

각 slice는 독립 input/output과 하나의 처리 파이프라인을 가진다. HTTP, WebSocket, 내부 Command DTO를 같은
객체로 공유하지 않는다. 현재 저장소의 usecase 함수와 module facade 관례를 따르며 MediatR나 class Handler를
새로 도입할 필요는 없다.

## ReadCursor aggregate

| 항목 | 결정 |
| --- | --- |
| aggregate key | `(userId, streamId)` |
| `userId` | 인증된 사람 사용자의 stable canonical identity |
| 상태 | `lastReadSequence`, 실제 전진 시각 |
| 부재 의미 | effective cursor 0 |
| 불변조건 | `0 <= lastReadSequence <= stream head` |
| 쓰기 소유자 | `mark-read-cursor`만 |

한 mark 트랜잭션은 정확히 한 ReadCursor aggregate만 쓴다. 상한 검증을 위해 stream head를 읽지만
`message_streams`나 `messages`를 수정하지 않는다.

물리 모델은 `(userId, streamId)` 복합 primary key와 `message_streams.stream_id`를 향한 `NO ACTION`
foreign key를 사용한다. 빈 channel의 `mark(0)`은 row를 만들지 않는다. identity provider user table의
소유권이 확정되기 전에는 추측으로 user foreign key를 추가하지 않는다.

## 저장소 접근 규칙

`mark-read-cursor`가 수정할 수 있는 저장소는 `read_cursors` 하나다. 다음은 직접 수정하지 않는다.

- messages와 stream head
- gateway ticket과 local session
- channel membership
- inbox/unread projection
- 다른 사용자의 cursor

다른 capability의 내부 Kysely helper나 usecase를 deep import하지 않는다. canonical stream identity, message
stream table, channel/auth source는 공개된 좁은 계약을 통해서만 사용한다.

## Slice 비책임

- 메시지를 실제로 화면에서 보았는지 서버가 증명하는 일
- sender message를 자동으로 제외하는 일
- read receipt broadcast
- delivery/history cursor 저장
- 정확한 unread count
- inbox projection
- bot/system/service principal 지원
