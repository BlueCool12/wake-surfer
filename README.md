# wake-surfer

WebSocket, WebRTC, RTMP 등을 활용한 화상 회의, 실시간 협업, 페어 프로그래밍 플랫폼입니다.

## 개발 환경

```bash
pnpm install
```

### Docker 개발 의존성

PostgreSQL과 Redis는 루트 `docker-compose.yml`로 실행합니다.
`apps/realtime-chat-api/docker/postgres.dev.env`는 로컬 개발 전용 PostgreSQL 기본값입니다.

```bash
pnpm docker:up
pnpm docker:ps
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
