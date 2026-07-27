# wake-surfer

WebSocket, WebRTC, RTMP 등을 활용한 화상 회의, 실시간 협업, 페어 프로그래밍 플랫폼입니다.

## 개발 환경

```bash
pnpm install
```

### 실제 채팅 MVP 실행

Docker가 실행 중인 상태에서 다음 명령 하나로 PostgreSQL과 migration을 준비하고,
Realtime Chat API·Gateway·웹을 빌드한 뒤 함께 실행합니다.

```bash
pnpm dev:realtime-chat
```

개발 실행기는 두 앱의 `.env.example`을 `team-internal` 배포 설정으로 읽어 각 프로세스에 완전하게
주입합니다. 앱 자체는 설정 기본값을 제공하지 않으므로 API 또는 Gateway를 직접 실행할 때는 해당 파일의
모든 항목을 명시해야 합니다. 현재 shell 환경의 같은 이름 변수로 예시값을 덮어쓸 수 있고, 두 앱의
`PORT`는 각각 `REALTIME_CHAT_API_PORT`, `REALTIME_CHAT_GATEWAY_PORT`로 덮어씁니다.
예시의 알려진 개발 token과 헤더 신뢰 모드는 로컬 전용이므로 두 서버는 `127.0.0.1`에 bind합니다.
다른 인터페이스에 노출할 때는 실제 token과 접근·전송 보안 설정을 함께 제공해야 합니다.

같은 채널에 서로 다른 actor로 접속하면 실시간 송수신과 새로고침 후 메시지 복구를 확인할 수 있습니다.

- `http://localhost:5173/rooms/general?actor=alice`
- `http://localhost:5173/rooms/general?actor=bob`

현재 MVP는 로컬 개발용 actor 헤더 인증과 단일 Gateway 안의 fan-out을 사용합니다. 운영 인증,
채널 권한, 여러 Gateway 사이의 fan-out은 후속 범위입니다.

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
