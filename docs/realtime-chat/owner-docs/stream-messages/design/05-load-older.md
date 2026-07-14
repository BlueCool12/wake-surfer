# Stream Messages 설계: Older Query

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 9. Query slice 3 — `load-older-stream-messages`

### 9.1 의도

사용자가 timeline을 위로 이동할 때 현재 history window의 가장 오래된 message보다 이전에 저장된 message를
추가로 가져온다.

이 Query는 delivery 누락 복구가 아니다. 완료되어도 `deliverySyncCursor`를 바꾸지 않는다.

### 9.2 확정된 처리 의미

1. actor와 selector를 검증하고 read authorization을 수행한다.
2. `sequence < beforeSequence`인 row 중 cursor에 가장 가까운 과거 N+1개를 선택한다.
3. DB에서는 효율적인 선택을 위해 내림차순으로 읽을 수 있다.
4. response는 client canonical order인 sequence 오름차순으로 반환한다.
5. 가장 오래된 반환 sequence를 다음 `beforeSequence` 경계로 제공한다.
6. 추가 row 존재 여부로 `hasMoreBefore`를 계산한다.

### 9.3 성공 결과가 표현해야 할 것

- Query correlation ID
- canonical `streamId`
- 요청한 `beforeSequence`
- sequence 오름차순 message page
- 다음 요청에 사용할 `nextBeforeSequence`
- `hasMoreBefore`

message page가 비어 있지 않으면 `nextBeforeSequence`는 반환한 가장 오래된 sequence이고, 비어 있으면
`null`이다.

### 9.4 불변조건

- `beforeSequence`는 exclusive cursor다.
- response message는 모두 `beforeSequence`보다 작다.
- 최신 append는 이미 고정된 older 범위를 흔들지 않는다.
- Query는 live sync cursor와 `ReadCursor`를 갱신하지 않는다.
- 각 page는 현재 actor의 read authorization을 다시 확인한다.

`beforeSequence`는 `1 <= beforeSequence <= headSequence + 1` 범위만 허용한다. 이는 stateless numeric
cursor의 유효 범위다. `headSequence + 1` 요청은 latest 구간과 겹칠 수 있으며 정상 client는 서버가 반환한
`nextBeforeSequence`를 사용한다. 겹친 message는 공통 merge model이 제거한다. 범위 밖 값은
`invalid_cursor`로 거절한다.

### 9.5 대표 acceptance scenario

- 현재 가장 오래된 message가 151이고 limit 50이면 `beforeSequence = 151` 요청은 101~150을
  오름차순으로 반환한다.
- 같은 요청 중 sequence 201이 append되어도 older page 결과는 바뀌지 않는다.
- 더 오래된 row가 없으면 빈 messages와 `hasMoreBefore = false`를 반환한다.
