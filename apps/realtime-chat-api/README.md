# realtime-chat-api app

`realtime-chat-api` is the deployable runtime shell for realtime chat API responsibilities.

The app owns runtime wiring only:

- load environment configuration
- create the PostgreSQL/Kysely runtime resource
- assemble `@wake-surfer/realtime-chat-gateway-ticket`
- expose Hono HTTP endpoints
- own Stream Messages public/internal HTTP transport mapping
- map domain rejections and infrastructure failures
- provide Pino logging and graceful shutdown

Gateway ticket rules and SQL remain owned by packages.

Database schema migration is not part of application startup. The root Compose
`realtime-chat-migrate` one-shot service must apply the Atlas versioned migrations before this app starts.

## Endpoints

```txt
GET  /health
POST /realtime-chat/gateway-tickets
POST /internal/realtime-chat/gateway-tickets/consume
GET  /realtime-chat/channels/:channelId/messages/latest
GET  /realtime-chat/channels/:channelId/messages/older
POST /internal/realtime-chat/channels/:channelId/messages/sync-after
```

Stream Messages route는 해당 개별 유스케이스가 app dependency로 제공될 때만 mount된다. app은 외부
schema 검증, 인증된 actor context 연결, 48KiB final-envelope 조정, HTTP 오류/status, rate limit과
request 관측성을 소유한다. 조회 권한, cursor, watermark와 Kysely는
`@wake-surfer/realtime-chat-stream-messages`가 소유한다.

provider의 `status: "failure"` 결과는 app이 `stream_unavailable` 404 또는 `invalid_cursor` 409 응답으로
변환한다. 성공 결과의 `StreamMessage`에는 transport 전용 `streamId`, target과 ISO timestamp가 없으므로,
app의 Stream Messages page policy가 요청 `channelId`를 사용해 외부 `PublicMessage`와 response를 조립한다.
DB·무결성·의존 서비스 예외만 retryable 503으로 처리한다.

Stream Messages 경로의 `x-request-id`는 전용 Hono middleware가 소유한다. 헤더가 없으면 UUID를 만들고,
계약의 `RequestIdSchema`를 만족하지 않는 값은 새 값으로 바꾸지 않고 `bad_request` 400으로 거부한다.
검증된 ID는 요청 Context와 응답 헤더에서 동일하게 사용한다.

`POST /realtime-chat/gateway-tickets` uses the authenticated actor context from
`REALTIME_CHAT_ACTOR_ID_HEADER`. It does not trust `actorId`, `userId`, or `workspaceId` from the request body.

`POST /internal/realtime-chat/gateway-tickets/consume` accepts only `{ "ticket": "..." }` in the JSON body.
The gateway identity is resolved from trusted gateway context, currently `REALTIME_CHAT_GATEWAY_ID_HEADER`
matched against `REALTIME_CHAT_GATEWAY_ID`.

모든 `/internal/realtime-chat/*` 요청은 Hono Bearer Auth middleware를 먼저 통과한다. 헤더가 없거나 token이
다르면 401, Authorization 형식이나 RFC 6750 Bearer token 문자가 올바르지 않으면 400을 반환하며,
`WWW-Authenticate` 헤더는 Hono 정책을 따른다. 오류 body는 프로젝트 공통 JSON envelope를 유지한다.
Bearer 검증 뒤에 trusted Gateway ID와 asserted actor를 별도로 검증한다.

## Actor resolution note

The current app uses trusted headers as a temporary authentication boundary. The final actor resolution model is not
decided yet.

The API must not assume that a JWT or session token directly contains `actorId`. If the auth token does not expose an
actor id, the API may resolve the actor from its own database or ask the auth server for a principal that can be mapped
to an actor. That decision belongs to the future authentication design.

The stable rule for this app is narrower: gateway ticket issuance needs a server-confirmed actor id, and that value must
not come from the client request body.
