# wake-surfer

WebSocket, WebRTC, RTMP 등을 활용한 화상 회의, 실시간 협업, 페어 프로그래밍 플랫폼입니다.

## 개발 환경

```bash
pnpm install
```

### 실제 채팅 MVP Docker 실행

Docker가 실행 중인 상태에서 다음 표준 명령 하나로 앱을 로컬 빌드하고 PostgreSQL·Redis·migration과
Realtime Chat API·Gateway·Web 전체를 배포합니다. 각 앱의 Dockerfile은 프로젝트를 빌드하지 않고
로컬에서 미리 생성한 실행 산출물만 runtime image에 복사합니다.

```bash
npm run deploy
```

같은 채널에 서로 다른 actor로 접속하면 실시간 송수신과 새로고침 후 메시지 복구를 확인할 수 있습니다.

- `http://localhost:5173/rooms/general?actor=alice`
- `http://localhost:5173/rooms/general?actor=bob`

현재 MVP는 로컬 개발용 actor 헤더 인증과 단일 Gateway 안의 fan-out을 사용합니다. 운영 인증,
채널 권한, 여러 Gateway 사이의 fan-out은 후속 범위입니다.

#### 앱 단독 배포

각 앱은 자기 `docker/` 디렉터리의 Compose·Dockerfile·환경 파일을 소유합니다. 다음 명령은 대상 앱
이미지만 빌드하고 `docker compose up -d --build --no-deps --force-recreate`로 교체하므로
PostgreSQL·Redis와 다른 앱 컨테이너를 다시 만들지 않습니다.

```bash
npm run deploy -- realtime-chat-api
npm run deploy -- realtime-chat-gateway
npm run deploy -- web
```

배포 스크립트는 API·Gateway의 esbuild 실행 번들과 Web의 Vite 정적 번들을 호스트에서 먼저 만듭니다.
Docker build context는 각 앱 모듈로 제한하며 `Dockerfile.dockerignore`를 통해 `dist`와 필요한
runtime 설정만 이미지 입력으로 전달합니다.

서비스 상태와 로그는 루트 Compose에서 서비스 이름으로 확인합니다.

```bash
docker compose ps
docker compose logs -f realtime-chat-api
docker compose logs -f realtime-chat-gateway
docker compose logs -f web
```

host Node·Vite 개발 서버가 필요한 경우에만 별도 명령을 사용합니다.

```bash
pnpm dev:realtime-chat:host
```

### Docker Compose 모듈 구조

루트 `docker-compose.yml`이 유일한 orchestration 진입점이며, 서비스 정의는 담당 모듈의 Compose
파일을 `include`합니다.

```text
docker-compose.yml
├─ packages/runtime-infra/docker/compose.yml
├─ packages/realtime-chat-database/docker/compose.yml
├─ apps/realtime-chat-api/docker/compose.yml
├─ apps/realtime-chat-gateway/docker/compose.yml
└─ apps/web/docker/compose.yml
```

- `runtime-infra`: 공용 PostgreSQL·Redis 단일 인스턴스
- `realtime-chat-database`: 일회성 Atlas migration
- `apps/*`: 앱별 runtime image와 독립 배포 계약

Compose `include`는 포함된 파일을 독립 application model로 읽고 상대 경로를 각 파일 기준으로
해석합니다. 앱 image build는 각 모듈을 최소 build context로 사용하며, Dockerfile은 로컬 `dist`와
최소 runtime 설정만 복사합니다.

- [Docker Compose include](https://docs.docker.com/reference/compose-file/include/)

### Docker 개발 인프라

PostgreSQL, realtime-chat Atlas migration, Redis만 먼저 준비하려면 기존 인프라 명령을 사용합니다.
`packages/runtime-infra/docker/postgres.dev.env`는 로컬 개발 전용 PostgreSQL 기본값입니다.

```bash
pnpm docker:up
pnpm docker:ps
```

`pnpm docker:up`은 PostgreSQL·Redis healthcheck 뒤 일회성 `realtime-chat-migrate` service를 실행합니다.
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

앱 공개 포트는 `REALTIME_CHAT_API_PORT`, `REALTIME_CHAT_GATEWAY_PORT`, `WAKE_SURFER_WEB_PORT`로
변경할 수 있습니다. 브라우저가 사용하는 origin과 Gateway URL이 달라지면
`REALTIME_CHAT_PUBLIC_WEB_ORIGIN`, `REALTIME_CHAT_PUBLIC_GATEWAY_URL`, 빌드 시
`VITE_API_BASE_URL`도 함께 맞춰야 합니다.

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
