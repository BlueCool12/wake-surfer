# realtime-chat-api app

외부에서 의존할 수 있는 엔드포인트, 헤더, 상태 코드와 운영 설정은
`apps/realtime-chat-api/public-docs/runtime-contract.md`에 정의한다.

`realtime-chat-api` is the deployable runtime shell for realtime chat API responsibilities.

The app owns runtime wiring only:

- load environment configuration
- create the PostgreSQL/Kysely runtime resource
- assemble `@wake-surfer/realtime-chat-gateway-ticket`
- expose Hono HTTP endpoints
- map domain rejections and infrastructure failures
- provide Pino logging and graceful shutdown

Gateway ticket rules and SQL remain owned by packages.

## Endpoints

```txt
GET  /health
GET  /health/live
GET  /health/ready
POST /realtime-chat/gateway-tickets
POST /internal/realtime-chat/gateway-tickets/consume
```

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
