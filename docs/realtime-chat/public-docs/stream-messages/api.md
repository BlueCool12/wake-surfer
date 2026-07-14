# Stream Messages 공개 API

## Query

Stream Messages는 세 개의 독립 Query로 나뉜다. 각 Query는 독립 input, output, Handler를 가진다.

| Query | Transport | 의미 |
| --- | --- | --- |
| latest | HTTP `GET` | 현재 head 기준 최신 최대 5개 |
| older | HTTP `GET` | exclusive `beforeSequence` 이전의 과거 page |
| sync-after | Gateway WebSocket relay | 고정 `throughSequence`까지 exclusive `afterSequence` 복구 |

MVP 공개 target은 channel만이다. server가 `channelId`를 canonical `channel:{channelId}` stream으로 resolve하고 response에는 `streamId`를 포함한다.

## Paging

- latest는 client limit과 cursor를 받지 않는다.
- older/after는 기본 50, 최대 100이다.
- 100 초과 limit, 음수·소수·unsafe integer cursor는 거절한다.
- 모든 response는 sequence 오름차순이다.
- after/before cursor는 exclusive다.
- final client-visible JSON envelope는 UTF-8 48KiB 이하이다.

## 공개 결과

- 접근할 수 없는 channel과 존재하지 않는 channel은 외부에서 `stream_unavailable`로 통합한다.
- malformed input은 `invalid_cursor`, `invalid_limit`, `invalid_request` 등 계약 오류다.
- DB, broker, API/Gateway timeout은 domain rejection이 아니라 retryable infrastructure failure다.

## 지원하지 않는 범위

DM, thread selector, SYSTEM message, channel list/inbox, message search, retention, multi-stream batch sync는 현재 공개 API에 포함하지 않는다.

## 관련 문서

- [불변조건](./invariants.md)
- [recovery semantics](./recovery.md)
- [owner decisions](../../owner-docs/stream-messages/decisions.md)
