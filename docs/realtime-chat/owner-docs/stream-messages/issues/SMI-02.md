# SMI-02 Stream Messages 공개 Query 계약 정의

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-01](./SMI-01.md)

### 필요한 공개 계약

- [Stream Messages API](../../../public-docs/stream-messages/api.md)
- [Stream Messages invariants](../../../public-docs/stream-messages/invariants.md)

### 관련 설계

- [02-slice-and-cursor-model.md](../design/02-slice-and-cursor-model.md)
- [08-authorization-contracts-and-transport.md](../design/08-authorization-contracts-and-transport.md)
- [09-performance-and-payload.md](../design/09-performance-and-payload.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-02. Stream Messages 공개 Query 계약 정의

**목표**

세 Query가 공유 다중-mode DTO 없이 독립된 request/response와 오류 의미를 갖게 한다.

**주요 변경**

- `packages/realtime-chat-stream-messages-contracts` 신규 생성
- latest, older, sync-after request/response strict schema
- HTTP와 WebSocket event payload schema
- domain rejection과 retryable infrastructure failure schema
- latest HTTP, older HTTP, `chat.stream.synced`의 canonical JSON serializer와 UTF-8 byte 측정 함수

**확정 공개 경계**

- `GET /realtime-chat/channels/:channelId/messages/latest`
- `GET /realtime-chat/channels/:channelId/messages/older?beforeSequence=...&limit=...`
- `POST /internal/realtime-chat/channels/:channelId/messages/sync-after`
- WebSocket `chat.stream.sync`
- WebSocket `chat.stream.synced`
- WebSocket `chat.stream.sync.rejected`
- WebSocket `chat.stream.sync.failed`

HTTP의 `x-request-id`와 WebSocket payload의 `requestId`가 correlation을 담당한다. internal API는 같은
`x-request-id`를 사용하며 request body에 actor를 넣지 않는다.

**완료 조건**

- latest request에는 client limit과 cursor가 없다.
- older와 after는 기본 50, 최대 100이며 101은 clamp하지 않고 거절한다.
- cursor/watermark/limit는 safe integer strict validation을 적용한다.
- `requestId`는 현재 API와 같은 최대 128자 제한을 적용한다.
- unknown field와 client-owned actor field를 거절한다.
- latest/older의 `nextBeforeSequence`는 non-empty면 가장 오래된 반환 sequence, empty면 `null`이다.
- after의 `nextAfterSequence`는 마지막 반환 sequence이며 empty final page에서는 `throughSequence`다.
- `stream_unavailable`, `invalid_cursor`, `bad_request`, `rate_limited`, retryable
  `stream_messages_unavailable`을 구분한다. `rate_limited`에는 `retryAfterMs`가 있다.
- `USER/TEXT` message만 허용하고 `SYSTEM` fixture를 거절한다.
- page envelope 상수 49,152 byte와 49,152/49,153 경계 테스트가 있다.
- boundary별 adapter/mount가 Handler에 주입할 canonical final-envelope measurer를 제공한다. Handler는 HTTP
  body나 WebSocket event serializer를 직접 import하지 않는다.
- 같은 value를 canonical serializer로 두 번 직렬화하면 같은 UTF-8 byte 수가 나온다.

**비범위**

- Web recovery의 10/500/512 묶음은 wire 계약이 아니라 client orchestration 규칙이므로 이 package에서
  공유 상수로 만들지 않는다.

권장 브랜치 slug: `stream-messages-contracts`

---
