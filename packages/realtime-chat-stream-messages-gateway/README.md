# @wake-surfer/realtime-chat-stream-messages-gateway

Gateway runtime이 Stream Messages의 `sync-after` 공개 계약을 중계할 때 사용하는 외곽 integration
패키지다.

## 공개 책임

- 인증된 Gateway service credential과 local-session actor를 사용해 API internal sync endpoint를 호출한다.
- `chat.stream.sync` frame을 검증하고 `chat.stream.synced`, rejection 또는 failure event로 변환한다.
- session generation, readiness, cancellation과 동일 channel 중복 요청을 처리한다.
- Gateway runtime과 rate limiter는 좁은 port로 주입받는다.

`createGatewayStreamMessagesApiClient`의 `gatewayApiToken`은 최소 32 UTF-8 byte이며 RFC 6750 Bearer token
문자 집합을 만족해야 한다. 이는 API가 사용하는 Hono Bearer Auth의 입력 정책과 동일하다.

이 패키지는 Stream Messages 조회 유스케이스나 Kysely에 의존하지 않는다. 실제 WebSocket 서버, session
registry, credential 설정과 Redis 연결은 Gateway app이 소유한다.

소비자는 package root만 import하고 `src/`를 직접 import하지 않는다.
