# apps/realtime-chat-api

Realtime chat API process shell입니다.

이 app은 Hono HTTP server를 만들고 `@wake-surfer/realtime-chat/api`의 `mountRealtimeChatApi`를 호출하는 composition root입니다. chat command, usecase, handler, domain model은 app에서 직접 만들지 않습니다.

현재 runtime은 smoke/demo용 in-memory adapter를 사용합니다. PostgreSQL schema와 migration ADR이 정리되면 Kysely/pg 기반 `RealtimeChatDbPort` adapter를 추가합니다.

```bash
pnpm --filter @wake-surfer/realtime-chat-api build
pnpm --filter @wake-surfer/realtime-chat-api start
```

필수 env:

- `NODE_ENV=development`
- `HOST=0.0.0.0`
- `PORT=3001`
- `LOG_LEVEL=info`
- `REALTIME_CHAT_BASE_PATH=/api/realtime-chat`
- `GATEWAY_TICKET_TTL_SECONDS=60`
- `MAX_MESSAGE_TEXT_LENGTH=4000`
- `SYNC_DEFAULT_LIMIT=50`
- `SYNC_MAX_LIMIT=100`

PostgreSQL을 사용할 때:

```powershell
$env:DATABASE_URL="<postgres-connection-url>"
pnpm --filter @wake-surfer/realtime-chat-api build
pnpm --filter @wake-surfer/realtime-chat-api start
```

`DATABASE_URL`이 없으면 in-memory adapter로 실행합니다.
