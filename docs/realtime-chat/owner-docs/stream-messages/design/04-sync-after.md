# Stream Messages 설계: Sync-after Query

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 8. Query slice 2 — `sync-stream-messages-after-sequence`

### 8.1 의도

다음 상황에서 client의 `deliverySyncCursor` 이후 저장 message를 조회해 고정된 stream snapshot까지
따라잡는다.

- WebSocket 재접속
- recipient offline
- outbound publish 또는 socket push 누락
- live sequence gap 감지
- sync page 중단 뒤 재개

이 Query는 현재 message-send의 “저장 성공과 delivery 성공은 별개”라는 의미를 완성하는 필수 복구 경로다.

### 8.2 확정된 처리 의미

첫 page:

1. actor와 selector를 검증하고 read authorization을 수행한다.
2. 현재 `headSequence`를 `throughSequence`로 고정한다.
3. `afterSequence <= throughSequence`를 검증한다.
4. `afterSequence < sequence <= throughSequence`를 오름차순으로 N+1개 조회한다.
5. 반환한 마지막 sequence를 `nextAfterSequence`로 제공한다.

후속 page:

1. 이전 응답과 동일한 `throughSequence`를 받는다.
2. 각 page마다 현재 actor의 read authorization을 다시 확인한다.
3. `nextAfterSequence` 이후부터 같은 상한까지만 읽는다.
4. 새 message가 생겨도 현재 sync snapshot에 포함하지 않는다.
5. 마지막 page를 적용한 뒤 `deliverySyncCursor`가 `throughSequence`에 수렴한다.

`throughSequence`는 pagination watermark이지 권한을 고정하는 capability token이 아니다. page 사이에 접근
권한이 철회되면 다음 page는 `stream_unavailable`로 중단되어야 한다.

### 8.3 성공 결과가 표현해야 할 것

- Query correlation ID
- canonical `streamId`
- 요청한 `afterSequence`
- 고정 `throughSequence`
- sequence 오름차순 message page
- `nextAfterSequence`
- `hasMoreAfter`

message page가 비어 있지 않으면 `nextAfterSequence`는 반환한 마지막 sequence다. 정상 final page가 비어
있으면 `nextAfterSequence`는 `throughSequence`와 같다.

### 8.4 불변조건

- `afterSequence`는 exclusive cursor다.
- 동일 요청은 DB가 변하지 않은 범위에서 같은 message order를 반환한다.
- 각 page는 유한하고 snapshot 상한은 page 사이에 움직이지 않는다.
- `hasMoreAfter = false`인 정상 final page의 `nextAfterSequence`는 `throughSequence`와 같아야 한다.
- live event와 sync page가 겹쳐도 `messageId` 기준으로 한 번만 적용한다.
- 같은 `streamId + sequence`에 다른 `messageId`가 오면 protocol/data invariant 위반이다.
- Query는 message, stream head, `ReadCursor`를 수정하지 않는다.

### 8.5 대표 acceptance scenario

- head가 100이고 `afterSequence = 97`, limit 2이면 첫 page는 98~99, 다음 cursor는 99,
  `hasMoreAfter = true`다.
- 다음 page는 동일한 `throughSequence = 100`으로 100을 반환하고 완료된다.
- 첫 page 뒤 101이 저장돼도 현재 snapshot에는 포함되지 않는다. 101은 live event 또는 다음 sync에서 처리한다.
- `afterSequence = headSequence`면 빈 성공이다.
- `afterSequence > headSequence`면 정상 빈 page로 위장하지 않고 invalid cursor로 처리한다.
