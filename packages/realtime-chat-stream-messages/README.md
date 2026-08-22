# @wake-surfer/realtime-chat-stream-messages

인증된 actor가 message stream을 조회하는 세 개의 독립적인 유스케이스를 제공한다.

## 공개 유스케이스

- `createLoadLatestMessages`: 현재 stream head를 기준으로 가장 최근 message를 최대 5개 조회한다.
- `createLoadOlderMessages`: `beforeSequence` 이전의 message를 과거 방향으로 조회한다.
- `createSyncAfterMessages`: `afterSequence` 이후의 message를 고정된 `throughSequence`까지 조회한다.

세 유스케이스는 message를 sequence 오름차순으로 반환한다. `older`와 `sync-after` cursor는 exclusive이며,
첫 `sync-after`가 정한 `throughSequence`는 복구가 끝날 때까지 유지한다.

각 유스케이스는 예상 가능한 성공과 실패를 `status` discriminated union으로 반환한다. 권한이 없는
stream은 `stream_unavailable`, 현재 stream head와 맞지 않는 cursor는 `invalid_cursor` 실패다. DB 연결
실패나 저장 row 무결성 훼손처럼 정상적인 유스케이스 분기가 아닌 문제만 예외로 전파한다.

각 factory는 자신의 slice 호출 함수만 반환한다. 세 유스케이스를 하나의 `Module` 객체로 묶어 공개하지
않는다.

## 책임

- channel과 DM은 해당 conversation 읽기 권한을 확인한다.
- thread는 root message가 속한 channel 또는 DM의 읽기 권한을 확인한다.
- message target을 canonical stream ID로 해석한다.
- cursor, fixed-watermark와 count limit 규칙을 적용한다.
- PostgreSQL을 일관된 read-only snapshot으로 조회한다.
- 조회 구간의 sequence 연속성과 저장 row의 무결성을 확인한다.
- target은 `message_streams`에서, text는 canonical `messages.content` JSONB parser를 통해 읽는다.
- transport contract와 독립적인 `StreamMessage` 조회 모델을 반환한다.
- `./table-contract`에서 독립 읽기 타입 `StreamMessagesDatabase`를 제공한다.

## 책임이 아닌 것

- message append와 쓰기 모델
- schema SQL과 migration 적용
- HTTP 또는 WebSocket 요청 검증·인증·오류 mapping
- 공개 request/response DTO와 JSON 직렬화
- `PublicMessage`와 외부 stream response 조립
- 최종 UTF-8 envelope 크기 측정과 48KiB 적용
- rate limit, timeout, request ID와 logging
- Gateway API client, WebSocket relay와 Web recovery orchestration

## 사용 예시

```ts
import {
  createLoadLatestMessages,
  createLoadOlderMessages,
  createSyncAfterMessages,
} from "@wake-surfer/realtime-chat-stream-messages";

const dependencies = {
  db,
  authorizeRead: ({ actorId, target }) =>
    canReadConversation(actorId, target) ? { status: "allowed" } : { status: "denied" },
};

const loadLatest = createLoadLatestMessages(dependencies);
const loadOlder = createLoadOlderMessages(dependencies);
const syncAfter = createSyncAfterMessages(dependencies);

const result = await loadLatest(
  { target: { type: "channel", channelId: "channel-1" } },
  { actorId: "actor-1" },
);

if (result.status === "failure") {
  // app이 result.code를 HTTP/WebSocket 응답 계약으로 mapping한다.
  return;
}

const page = result.page;
```

`actorId`는 이미 인증된 application principal의 식별자다. 어떤 header, session, ticket 또는 token에서
actor를 확정할지는 소비 app이 결정한다.

`StreamMessage`는 조회한 channel, DM 또는 thread를 구분하는 `target`을 포함하지만 저장소 partition key인
`streamId`는 공개하지 않는다. 소비 app은 요청 target과 조회 결과를 사용해 자신이 소유한 외부 response
contract를 조립한다. 조회 모델의 timestamp는 `Date`이며 ISO 문자열 직렬화도 app 경계의 책임이다.

소비자는 package root와 `./table-contract`만 import하고 `src/usecases`를 직접 import하지 않는다.
