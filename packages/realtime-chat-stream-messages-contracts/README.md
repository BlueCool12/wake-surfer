# @wake-surfer/realtime-chat-stream-messages-contracts

Stream Messages의 latest, older, sync-after 조회 경계에서 공유하는 versioned 공개 계약이다.

## 공개 계약

- `GET /realtime-chat/channels/:channelId/messages/latest`의 request/response schema
- `GET /realtime-chat/channels/:channelId/messages/older`의 request/response schema
- `POST /internal/realtime-chat/channels/:channelId/messages/sync-after`의 request/response schema
- `chat.stream.sync`, `chat.stream.synced`, `chat.stream.sync.rejected`,
  `chat.stream.sync.failed` WebSocket payload schema
- cursor, watermark, page limit, request ID와 공개 오류 코드
- latest HTTP, older HTTP, `chat.stream.synced`의 canonical JSON serializer와 UTF-8 byte measurer

세 Query는 request/response schema를 공유하지 않는다. 공통 message item은 이 패키지가 아니라
`@wake-surfer/realtime-chat-message-contracts`의 `PublicMessage`를 사용한다.

## 입력과 pagination

- latest request에는 client-controlled cursor와 limit가 없다.
- older와 sync-after의 limit는 생략 시 50이며 1~100 safe integer만 허용한다.
- older와 sync-after response도 page당 최대 100개 message만 허용한다.
- `beforeSequence`는 1 이상의 safe integer, `afterSequence`와 `throughSequence`는 0 이상의 safe integer다.
- strict object schema로 unknown field와 client-owned actor field를 거절한다.
- `requestId`는 WebSocket payload에서만 사용하며, 원문을 변환하지 않고 최대 128자로 제한한다. HTTP와
  internal sync의 correlation은 `x-request-id` header에 같은 `RequestIdSchema`를 적용한다.

## 응답과 오류

- latest/older의 비어 있지 않은 page `nextBeforeSequence`는 가장 오래된 반환 sequence이며, 빈 page는
  `null`이다.
- sync-after의 `nextAfterSequence`는 마지막 반환 sequence이며, 빈 final page에서는
  `throughSequence`다.
- 모든 response의 `streamId`는 canonical channel stream ID이며 cursor 경계부터 sequence가 연속돼야 한다.
- domain rejection은 `stream_unavailable`, `invalid_cursor`, `bad_request`, `rate_limited`로 구분한다.
  `rate_limited`에는 양의 safe integer `retryAfterMs`가 필요하다.
- retryable infrastructure failure는 `stream_messages_unavailable`과 `retryable: true`로 표현한다.

## 최종 envelope 측정

`MAX_STREAM_MESSAGES_PAGE_ENVELOPE_UTF8_BYTES`는 49,152 byte다. adapter/mount는 다음 함수를
Handler에 `FinalEnvelopeMeasurer`로 주입한다.

- `measureLatestStreamMessagesHttpFinalEnvelope`
- `measureOlderStreamMessagesHttpFinalEnvelope`
- `measureChatStreamSyncedFinalEnvelope`

Handler는 HTTP body나 WebSocket serializer를 import하지 않고, 주입된 결과의 `utf8ByteLength`와
`isWithinLimit`만으로 page를 결정한다. adapter는 전송 직전에 같은 canonical serializer를 다시 사용해
상한을 검사한다.

## 비공개 내부 모델

이 패키지는 다음을 소유하지 않는다.

- Query Handler, database query, N+1 조회와 authorization
- channel target을 canonical stream으로 resolve하는 정책
- HTTP route와 Gateway mount, 인증 actor 주입, internal service credential
- rate-limit 저장소와 실제 재시도 정책
- Web recovery의 10 page / 500 message / 512KiB orchestration
