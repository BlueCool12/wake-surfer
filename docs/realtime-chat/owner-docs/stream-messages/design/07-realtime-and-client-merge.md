# Stream Messages 설계: 실시간 수신과 client merge

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 12. 실시간 메시지 수신과의 경계

사용자가 “메시지를 받는다”는 표현에는 두 흐름이 있다.

| 흐름 | 입력 | 구현 종류 | 소유 경계 |
| --- | --- | --- | --- |
| 저장 message를 요청해 받음 | Query request | Query Handler | `stream-messages` |
| 새 message를 실시간 push로 받음 | outbound delivery event | Event Handler | outbound delivery/Gateway |

실시간 흐름은 다음과 같다.

```txt
OutboundMessageDeliveryRequested
→ 모든 Gateway subscriber
→ recipientActorIds로 local session 조회
→ 해당 socket에 chat.message.created push
```

따라서 `receive-message` Query를 새로 만들지 않는다. 대신 Query result와 live event가 같은 client merge
invariant를 만족해야 한다.

## 13. Client merge와 race 처리

모든 message 입력 경로는 하나의 stream merge model을 통과해야 한다.

입력 source는 다음과 같다.

- latest page
- after sync page
- older page
- realtime created event
- sender accepted correlation

공통 규칙은 다음과 같다.

- canonical ordering은 `streamId + sequence`다.
- `messageId`가 이미 있으면 중복 삽입하지 않는다.
- 같은 `streamId + sequence`의 다른 `messageId`는 오류로 기록하고 자동 덮어쓰지 않는다.
- live sequence가 `deliverySyncCursor + 1`보다 크면 buffer하고 after sync를 예약한다.
- sequence가 `deliverySyncCursor` 이하이고 현재 loaded history window 밖이면 오래 지연된 pre-checkpoint
  event로 보고 현재 window에는 삽입하지 않는다. 필요하면 older query가 다시 가져온다.
- sequence가 `deliverySyncCursor` 이하이면서 현재 loaded window 안인데 해당 message가 없다면 snapshot
  누락 또는 계약 위반으로 기록한다.
- latest/sync 요청 전에 live listener를 활성화하고 응답이 올 때까지 live message를 안전하게 buffer한다.
- latest snapshot의 `throughSequence` 이하 live event는 page와 deduplicate한다.
- `throughSequence`보다 큰 live event는 snapshot 이후 message로 순서대로 적용한다.
- older page는 timeline 앞에 merge하지만 `deliverySyncCursor`를 바꾸지 않는다.
- `ReadCursor` 전진은 별도 사용자 command에서만 일어난다.

현재 `useChatRoom`의 배열 교체 방식은 이 규칙을 보장하지 못한다. client merge model은 Web chat feature가
소유하고, `deliverySyncCursor`와 진행 중 `throughSequence`는 `sessionStorage`에 저장한다. 위 protocol
invariant는 server contract와 client model 양쪽에서 같은 acceptance scenario로 검증한다.
