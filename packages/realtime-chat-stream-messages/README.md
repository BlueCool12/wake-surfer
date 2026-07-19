# @wake-surfer/realtime-chat-stream-messages

인증된 actor가 channel message stream을 조회하는 세 Query를 제공한다.

## 공개 Query

- `loadLatest`: 현재 stream head를 기준으로 가장 최근 message를 최대 5개 조회한다.
- `loadOlder`: `beforeSequence` 이전의 message를 과거 방향으로 조회한다.
- `syncAfter`: `afterSequence` 이후의 message를 고정된 `throughSequence`까지 조회한다.

세 Query는 message를 sequence 오름차순으로 반환한다. `older`와 `sync-after` cursor는 exclusive이며,
첫 `sync-after`가 정한 `throughSequence`는 복구가 끝날 때까지 유지한다.

## 책임

- channel 읽기 권한을 확인한다.
- channel을 canonical stream ID로 해석한다.
- cursor와 fixed-watermark 규칙을 적용한다.
- PostgreSQL을 일관된 read-only snapshot으로 조회한다.
- 조회 구간의 sequence 연속성과 저장 row의 무결성을 확인한다.
- `./table-contract`에서 독립 읽기 타입 `StreamMessagesDatabase`를 제공한다.

## 책임이 아닌 것

- message append와 쓰기 모델
- schema SQL과 migration 적용
- HTTP 또는 WebSocket 요청 인증 정보 추출
- JSON 직렬화와 최종 UTF-8 envelope 크기 측정
- rate limit, timeout, request ID, logging
- Gateway relay와 Web recovery orchestration

`StreamMessagesModule`은 개수 기준의 논리적 page를 반환한다. package가 제공하는 HTTP 어댑터는 최종
48KiB envelope에 맞춰 message와 continuation cursor를 조정한다.

## 사용 예시

```ts
import { createStreamMessagesModule } from "@wake-surfer/realtime-chat-stream-messages";

const streamMessages = createStreamMessagesModule({
  db,
  authorizeRead: ({ actorId, channelId }) =>
    canReadChannel(actorId, channelId) ? { status: "allowed" } : { status: "denied" },
});

const page = await streamMessages.loadLatest(
  { channelId: "channel-1" },
  { actorId: "actor-1" },
);
```

소비자는 package root와 `./table-contract`만 import하고 `src/usecases`를 직접 import하지 않는다.
