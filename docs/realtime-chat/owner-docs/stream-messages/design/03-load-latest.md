# Stream Messages 설계: Latest Query

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 7. Query slice 1 — `load-latest-stream-messages`

### 7.1 의도

사용자가 MVP channel 화면에 처음 진입했을 때 현재 stream의 최신 message window를 최대 5개 가져오고,
이후 live sync를 시작할 snapshot 기준점을 얻는다.

`afterSequence = 0`으로 오래된 stream 전체를 순회하는 것은 이 유스케이스가 아니다.

### 7.2 확정된 처리 의미

1. 인증 actor와 target/stream selector를 검증한다.
2. message content를 읽기 전에 read authorization을 수행한다.
3. canonical stream과 현재 `headSequence`를 확인한다.
4. `headSequence` 이하의 최신 6개까지 고른다.
5. 최신 5개만 response에 포함하고 sequence 오름차순으로 반환한다.
6. 추가 row 존재 여부로 `hasMoreBefore`를 계산한다.
7. 응답의 `throughSequence`를 live `deliverySyncCursor`의 checkpoint로 제공한다.

MVP `load-latest-stream-messages` request에는 client가 조절하는 `limit`을 두지 않는다. 5는 기본값이 아니라
서버가 보장하는 initial window 상한이다. after/older page는 기본 50개, 최대 100개로 확정한다.

### 7.3 성공 결과가 표현해야 할 것

- Query correlation ID
- canonical `streamId`
- snapshot `throughSequence`
- sequence 오름차순 message page
- 다음 older 요청에 사용할 `nextBeforeSequence`
- `hasMoreBefore`

message page가 비어 있지 않으면 `nextBeforeSequence`는 반환한 가장 오래된 sequence이고, 비어 있으면
`null`이다.

### 7.4 불변조건

- response message는 모두 같은 stream에 속한다.
- message sequence는 엄격히 증가한다.
- 어떤 message도 `throughSequence`보다 클 수 없다.
- `headSequence > 0`이면 non-empty latest page의 마지막 message sequence는 반드시
  `throughSequence`와 같다.
- current no-retention 모델에서는 반환한 tail window 내부 sequence가 연속이어야 한다.
- latest 5개를 선택하는 DB 내부 정렬과 client에 반환하는 정렬을 구분한다.
- Query는 `ReadCursor`를 갱신하지 않는다.
- 유효하고 읽을 수 있지만 아직 message가 없는 channel은 빈 성공이어야 한다.

마지막 조건은 현재 구현에서 특히 중요하다. `message_streams` row는 첫 message append 때 lazy create된다.
따라서 stream row가 없다는 이유만으로 channel 미존재 또는 권한 없음으로 판단하면 안 된다. 빈 channel은
placeholder message나 미리 생성된 공개 stream 객체로 표현하지 않고, `messages = []`인 성공 결과로만
표현한다. 빈 thread는 이 규칙의 예외이며 `SM-22`에 따라 존재하지 않는 조회 대상으로 취급한다.

### 7.5 대표 acceptance scenario

- sequence 1~200이 있으면 196~200을 오름차순으로 반환한다.
- `throughSequence`는 200이고 `hasMoreBefore`는 true다.
- query snapshot 뒤 sequence 201이 live event로 도착하면 latest response와 별도로 병합되어 최종 cursor가
  201까지 전진한다.
- 읽을 수 있는 빈 channel은 `throughSequence = 0`, 빈 messages, `hasMoreBefore = false`를 반환한다.
