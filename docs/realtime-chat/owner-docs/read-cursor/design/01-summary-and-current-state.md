# Read Cursor 설계: 결론 요약과 현재 저장소

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## 결론

`mark-read-cursor`는 인증된 사람 사용자가 한 채널에서 특정 sequence까지 읽었다고 선언하고, 그 사용자의
`ReadCursor`를 단조 증가시키는 하나의 쓰기 유스케이스다.

- 영속 key는 stable canonical `userId`와 canonical `streamId`의 조합이다.
- 저장 핵심 값은 `lastReadSequence`다.
- 같은 값이나 낮은 값의 재요청은 `unchanged` 성공이다.
- message, stream head, session, unread projection은 같은 트랜잭션에서 수정하지 않는다.
- 조회 Query와 live merge는 ReadCursor를 암묵적으로 갱신하지 않는다.
- 다른 사용자에게 read receipt를 방송하지 않는다.

`get-channel-read-state`는 재접속·새 기기·다른 탭이 현재 cursor와 `hasUnread`를 복구하는 별도 읽기
유스케이스다. Command에 Query mode를 섞지 않는다.

## 현재 구현 상태

| 영역 | 현재 사실 | 구현 영향 |
| --- | --- | --- |
| Read Cursor package/contracts | 없음 | 구현 package와 계약 package가 필요하다. |
| read cursor table/migration | 없음 | feature table contract와 database 합성이 필요하다. |
| message stream | Message Send가 `message_streams`와 sequence를 소유한다. | Read Cursor는 공개 table/stream identity 계약만 읽고 내부 query를 deep import하지 않는다. |
| API/Gateway app | 추적되는 실행 코드가 없다. | package-owned adapter와 shell mount 위치를 이슈에서 함께 만든다. |
| Web chat | mock transport와 임시 상태만 있다. | 실제 인증 session, Stream Messages merge, transport 결과에 의존한다. |
| identity/channel source | production 기준 상태가 없다. | shared auth/channel 선행 이슈가 출시 차단 조건이다. |

## 현재 message stream과 identity 경계

Message Send는 stream별 `last_sequence`를 원자적으로 증가시키고 message를 저장한다. Read Cursor는 상한
검증을 위해 primary DB의 stream head를 읽을 수 있지만 stream이나 message를 수정하지 않는다.

Gateway Ticket의 `actorId`는 인증된 실시간 principal이며 장기 사용자 ID와 같은 개념으로 보장되지 않는다.
Read Cursor는 이를 그대로 저장하지 않고 인증된 사람 사용자의 stable canonical `userId`로 해석한다.
봇·system·service account는 범위에 포함하지 않는다.

## Stream Messages에서 상속한 결정

- MVP target은 channel-only이고 외부 selector는 `channelId`다.
- 서버가 `channel:{channelId}` canonical stream identity를 해석한다.
- `deliverySyncCursor`, history cursor, ReadCursor는 서로 다른 상태다.
- 읽을 수 있는 빈 channel은 stream row가 없어도 head 0인 성공이다.
- content/state 조회 전에 권한을 확인하고 not-found/forbidden은 `stream_unavailable`로 통합한다.
- 현재 sequence gap은 data-integrity failure이며 retention/hard delete는 비범위다.
- sequence는 음수·소수·unsafe integer를 거절한다.
- client actor ID를 신뢰하지 않고 인증 edge 또는 인증된 Gateway assertion만 사용한다.

## 현재 Web의 빈 자리

- mark-read command와 결과 처리
- 활성 channel과 문서 visibility를 결합한 읽음 판단
- merge/render가 끝난 최대 연속 sequence 추적
- 서버 read state 복구
- `hasUnread` 표시

따라서 backend command만 구현하는 티켓으로 제품 완료를 선언할 수 없다.
