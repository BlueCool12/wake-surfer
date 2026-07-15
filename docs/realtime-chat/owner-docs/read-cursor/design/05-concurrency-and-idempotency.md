# Read Cursor 설계: 트랜잭션, 동시성, 멱등성

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## 필수 DB 보장

애플리케이션의 `SELECT -> 비교 -> UPDATE`만으로 단조 증가를 보장하지 않는다. primary PostgreSQL의 조건부
upsert가 다음을 원자적으로 보장해야 한다.

- row가 없고 `S > 0`이면 `S`로 생성한다.
- 현재 값이 `S`보다 작으면 `S`로 갱신한다.
- 현재 값이 `S` 이상이면 쓰지 않는다.
- no-op에서는 `updated_at`도 바꾸지 않는다.
- 결과에는 요청값이 아니라 처리 뒤 effective cursor를 반환한다.

stream head 상한 확인과 cursor upsert는 primary DB의 짧은 트랜잭션에서 실행한다. replica head는 복제
지연으로 정상 최신 sequence를 미래값으로 오판할 수 있으므로 사용하지 않는다.

## 대표 경쟁 조건

| 초기 상태 | 동시 요청 | 최종값 |
| --- | --- | --- |
| 80 | 100, 120 | 120 |
| row 없음 | 10, 20 | 20 |
| 120 | 100, 120 | 120 |

낮은 요청이 늦게 끝나도 최종값은 최댓값이어야 한다. 각 응답은 자신의 입력값이 아니라 처리 시점의
effective cursor를 반환할 수 있다.

## 자연 멱등성

별도 idempotency/result table을 만들지 않는다.

- 최초 `mark(100)`은 `advanced(100)`일 수 있다.
- 같은 요청의 재전송은 `unchanged(100)`일 수 있다.
- 사이에 다른 기기가 120으로 전진하면 재전송 결과는 `unchanged(120)`일 수 있다.

같은 과거 outcome 문자열 재현이 아니라 여러 번 적용해도 상태가 잘못되지 않는 것이 보장이다.

## Message append와의 경쟁

상한을 읽은 직후 새 message가 append돼도 이미 검증된 `S <= head`는 계속 유효하다. 요청 시점에는
미래였던 sequence가 직후 append로 생긴 경우에는 현재 요청을 `invalid_cursor`로 거절하고 client가
동기화한 뒤 재시도한다.

## 요청 병합과 제한

Web은 같은 channel에서 아직 보내지 않은 mark를 가장 큰 sequence 하나로 합치고 짧게 debounce한다. 이미
전송한 낮은 요청은 취소할 필요가 없으며 DB 단조 증가가 correctness를 보장한다.

Gateway/API는 공통 분산 rate limit을 적용한다. 정확한 임계값은 운영 설정이지만 limiter나 debounce가
없어도 cursor 불변조건은 깨지지 않아야 한다.
