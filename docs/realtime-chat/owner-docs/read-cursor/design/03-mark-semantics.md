# Read Cursor 설계: Mark 의미와 client 발행 조건

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## Mark의 의미

sequence `S`를 mark한다는 뜻은 다음과 같다.

> 이 사람 사용자는 이 stream에서 sequence가 `S` 이하인 모든 메시지를 읽은 것으로 간주한다.

서버가 viewport 노출을 증명하는 모델이 아니다. client가 승인된 제품 규칙에 따라 읽음 의도를 판단하고,
서버는 권한·상한·단조 증가 규칙 안에서 그 선언을 기록한다.

## Latest 진입 baseline

다음 조건을 모두 만족하면 latest 응답의 `throughSequence`를 mark한다.

- channel이 현재 활성 channel이다.
- 브라우저/앱이 foreground이고 문서가 visible하다.
- latest 최대 5개가 sequence-aware 상태에 merge되고 화면 render까지 끝났다.

이때 로드하지 않은 더 오래된 메시지도 읽은 것으로 간주한다. viewport에 실제 노출된 메시지만 추적하는
가시성 모델은 만들지 않는다.

## Sync/live 전진

일반 sync와 live 수신은 client가 연속 적용한 가장 큰 sequence까지만 mark한다. gap이 있는 상태에서 더 큰
sequence를 먼저 받았으면 mark하지 않는다. gap이 채워져 순서 인식 merge를 마친 뒤 전진한다.

다음 동작만으로는 mark하지 않는다.

- background socket이 message를 받음
- network 응답이 도착했지만 상태 merge/render가 끝나지 않음
- 비활성 channel cache가 갱신됨
- sequence gap 뒤의 message를 먼저 받음

## 빈 channel

- 권한 provider가 readable channel임을 확인한다.
- 논리 head는 0이다.
- `mark(0)`은 row를 만들지 않는 `unchanged(0)`이다.
- `mark(S > 0)`은 `invalid_cursor`다.

## 미래 sequence와 gap

요청 sequence가 primary DB head보다 크면 clamp하지 않고 `invalid_cursor`로 거절한다. 실제 head는 응답에
노출하지 않는다.

현재는 sequence가 연속이고 hard delete가 없으므로 `S <= head`이면 개별 message row 존재 조회 없이 유효한
경계로 취급한다. retention이나 삭제로 gap을 허용하면 unread 계산을 별도 재결정해야 한다.
