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

`POST /realtime-chat/gateway-tickets` uses the authenticated actor context from
`REALTIME_CHAT_ACTOR_ID_HEADER`. It does not trust `actorId`, `userId`, or `workspaceId` from the request body.

`POST /internal/realtime-chat/gateway-tickets/consume` accepts only `{ "ticket": "..." }` in the JSON body.
The gateway identity is resolved from trusted gateway context, currently `REALTIME_CHAT_GATEWAY_ID_HEADER`
matched against `REALTIME_CHAT_GATEWAY_ID`.

## Actor resolution note

The current app uses trusted headers as a temporary authentication boundary. The final actor resolution model is not
decided yet.

The API must not assume that a JWT or session token directly contains `actorId`. If the auth token does not expose an
actor id, the API may resolve the actor from its own database or ask the auth server for a principal that can be mapped
to an actor. That decision belongs to the future authentication design.

The stable rule for this app is narrower: gateway ticket issuance needs a server-confirmed actor id, and that value must
not come from the client request body.
