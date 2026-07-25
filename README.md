# wake-surfer

WebSocket, WebRTC, RTMP 등을 활용한 화상 회의, 실시간 협업, 페어 프로그래밍 플랫폼입니다.

## 개발 환경

```bash
pnpm install
```

### Docker 개발 의존성

PostgreSQL, realtime-chat Atlas migration, Redis는 루트 `docker-compose.yml`로 실행합니다.
`apps/realtime-chat-api/docker/postgres.dev.env`는 로컬 개발 전용 PostgreSQL 기본값입니다.

```bash
pnpm docker:up
pnpm docker:ps
```

`pnpm docker:up`은 PostgreSQL healthcheck 뒤 일회성 `realtime-chat-migrate` service를 실행합니다.
migration만 다시 적용하거나 migration 디렉터리를 검증하려면 다음 명령을 사용합니다.

```bash
pnpm db:migrate:realtime-chat
pnpm db:validate:realtime-chat
```

기본 접속 정보:

```txt
PostgreSQL: postgresql://wake_surfer_realtime_chat:wake_surfer_realtime_chat_dev_password@localhost:5432/wake_surfer_realtime_chat
Redis: redis://localhost:6379
```

기본 포트가 이미 사용 중이면 `REALTIME_CHAT_POSTGRES_PORT`, `REALTIME_CHAT_REDIS_PORT` 환경 변수로 호스트 포트를 바꿀 수 있습니다.

```powershell
$env:REALTIME_CHAT_POSTGRES_PORT = "15432"
$env:REALTIME_CHAT_REDIS_PORT = "16379"
pnpm docker:up
```

## 검증

```bash
pnpm lint
pnpm format:check
```

### realtime-chat PostgreSQL 통합 테스트

통합 테스트는 Docker Compose의 PostgreSQL 18을 사용합니다. 먼저 의존 서비스를 실행한 뒤,
host test process가 사용할 `TEST_DATABASE_URL`과 Compose 내부 Atlas container가 사용할
`TEST_ATLAS_DATABASE_URL`을 명시하고 루트 명령 하나로 실행합니다. 두 환경 변수는 필수이며 일반 runtime
database URL로 대체되지 않습니다.

```powershell
pnpm docker:up
$env:TEST_DATABASE_URL = "postgresql://wake_surfer_realtime_chat:wake_surfer_realtime_chat_dev_password@localhost:5432/wake_surfer_realtime_chat"
$env:TEST_ATLAS_DATABASE_URL = "postgres://wake_surfer_realtime_chat:wake_surfer_realtime_chat_dev_password@realtime-chat-postgres:5432/wake_surfer_realtime_chat?sslmode=disable"
pnpm test:integration:realtime-chat
```

```bash
pnpm docker:up
TEST_DATABASE_URL=postgresql://wake_surfer_realtime_chat:wake_surfer_realtime_chat_dev_password@localhost:5432/wake_surfer_realtime_chat \
TEST_ATLAS_DATABASE_URL='postgres://wake_surfer_realtime_chat:wake_surfer_realtime_chat_dev_password@realtime-chat-postgres:5432/wake_surfer_realtime_chat?sslmode=disable' \
pnpm test:integration:realtime-chat
```

각 테스트 suite와 worker는 고유한 임시 PostgreSQL schema에 Atlas versioned migration을 적용하고,
성공·실패 뒤 해당 schema를 삭제합니다. 따라서 로컬 PostgreSQL의 다른 schema를 지우지 않습니다.
