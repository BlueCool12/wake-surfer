# Stream Messages recovery

## Watermark

첫 after page가 반환한 numeric `throughSequence`를 recovery가 끝날 때까지 고정한다. 후속 page는 같은 stream과 watermark 범위 안에서만 읽는다.

## Cursor

recovery cursor는 마지막으로 완전히 적용한 `nextAfterSequence`다. 부분 적용 page나 실패한 page는 cursor를 전진시키지 않는다.

## 자동 재개

한 recovery batch는 다음 중 먼저 도달하면 `recovery_pending`으로 양보한다.

- 10개 page
- 500개 message
- 누적 512KiB

자동 재개는 같은 watermark와 마지막 완전 적용 cursor를 사용한다. `hasMoreAfter = true`인데 cursor가 전진하지 않으면 protocol failure다.

## 저장 범위

cursor와 진행 중 watermark는 `sessionStorage`에 actor+channel 단위로 저장한다. Gateway session ID를 key로 사용하지 않는다. logout 또는 account change 시 폐기한다.

## 재연결 순서

기존 cursor가 있으면 latest로 건너뛰지 않고 after recovery를 먼저 수행한다. 실시간 연결이 회복된 뒤에도 sequence-aware merge를 통해 live event와 recovery 결과를 중복 없이 합친다.
