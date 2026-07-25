# realtime-chat-api app

`realtime-chat-api` is the deployable runtime shell for realtime chat API responsibilities.

The app owns runtime wiring only:

- load environment configuration
- create the PostgreSQL/Kysely runtime resource
- assemble `@wake-surfer/realtime-chat-gateway-ticket`
- assemble `@wake-surfer/realtime-chat-message-send`
- assemble the three `@wake-surfer/realtime-chat-stream-messages` query slices
- expose Hono HTTP endpoints
- own the internal Message Send HTTP transport mapping
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
POST /internal/realtime-chat/messages
GET  /realtime-chat/channels/:channelId/messages/latest
GET  /realtime-chat/channels/:channelId/messages/older
POST /internal/realtime-chat/channels/:channelId/messages/sync-after
```

실행 런타임은 Message Send와 Stream Messages의 세 조회 유스케이스를 같은 PostgreSQL 연결에 조립한다.
현재 MVP는 인증된 actor의 모든 channel 읽기·쓰기를 허용하고 DM과 thread 쓰기는 거절한다. 이는 채팅
세로 흐름을 검증하기 위한 임시 정책이며, 실제 channel membership/permission provider로 교체해야 한다.
actor 인증과 Gateway service 인증은 이 임시 권한 정책과 별개로 계속 필수다.

Stream Messages route는 테스트처럼 해당 개별 유스케이스가 app dependency로 제공될 때만 mount할 수도
있다. app은 외부 schema 검증, 인증된 actor context 연결, 48KiB final-envelope 조정, HTTP 오류/status,
rate limit과 request 관측성을 소유한다. 조회 권한, cursor, watermark와 Kysely는
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

`POST /internal/realtime-chat/messages` accepts the strict
`@wake-surfer/realtime-chat-message-send-contracts` request body. The Gateway and asserted actor are resolved from
trusted headers, so `actorId` and other server-owned fields are rejected from the body. Accepted and domain-rejected
commands both return the shared `SendMessageResponse` with HTTP 200. Persistence failures return the common error
envelope with HTTP 503.

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

## Docker 배포

이 앱의 Docker 자산은 `docker/`가 소유한다.

- `docker/compose.yml`: API container, 상태 확인, 공개 포트와 내부 의존성
- `docker/runtime.dev.env`: container 내부 개발 runtime 환경
- `docker/Dockerfile`: 사전 생성된 `docker/artifact/`만 복사하는 Node runtime image
- `docker/volumes/`: API가 향후 소유할 volume mount content 경계

Dockerfile은 TypeScript compile이나 dependency install을 실행하지 않는다. 루트 배포 스크립트가
로컬 `build`와 filtered offline production install을 끝낸 뒤 API image를 교체한다.

```bash
npm run deploy -- realtime-chat-api
docker compose logs -f realtime-chat-api
```

이 명령은 `--no-deps`로 API만 교체한다. PostgreSQL과 migration이 준비되지 않은 최초 환경에서는 먼저
전체 `npm run deploy`를 실행한다.
