# @wake-surfer/runtime-infra

로컬 Docker runtime에서 공유하는 PostgreSQL·Redis 단일 인스턴스를 소유한다.

루트 `docker-compose.yml`이 이 모듈의 `docker/compose.yml`을 include하며, 앱별 독립 배포는 이
서비스들을 다시 만들지 않는다.

```bash
pnpm docker:up
docker compose ps realtime-chat-postgres realtime-chat-redis
```

기본 host 접속 주소:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
