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
npm run deploy -- realtime-media-gateway
npm run deploy -- web
```

배포 스크립트는 API·Gateway의 esbuild 실행 번들과 Web의 Vite 정적 번들을 호스트에서 먼저 만듭니다.
Docker build context는 각 앱 모듈로 제한하며 `Dockerfile.dockerignore`를 통해 `dist`와 필요한
runtime 설정만 이미지 입력으로 전달합니다. `realtime-media-gateway`만 예외로, mediasoup의 네이티브
`mediasoup-worker` 바이너리를 얻기 위해 Dockerfile 안에서 별도 빌드 스테이지를 한 번 더 거칩니다.

서비스 상태와 로그는 루트 Compose에서 서비스 이름으로 확인합니다.

```bash
docker compose ps
docker compose logs -f realtime-chat-api
docker compose logs -f realtime-chat-gateway
docker compose logs -f realtime-media-gateway
docker compose logs -f web
```

음성 통화는 위와 같은 방 URL에서 헤드셋 아이콘으로 참가합니다. `alice`·`bob` 두 탭 모두 참가하면
양방향 오디오가 붙습니다. 인증·재연결 내성·녹음은 아직 없습니다(로컬 개발 전제와 동일한 수준).

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

같은 호스트가 아니라 다른 서버에 배포하고 여러 기기에서 접속한다면(같은 컴퓨터의 탭 두 개가
아니라, 서로 다른 기기가 서버 IP·도메인으로 접속하는 경우), `MEDIASOUP_ANNOUNCED_ADDRESS`를
그 서버가 실제로 도달 가능한 IP나 도메인으로 반드시 지정해야 합니다. 기본값 127.0.0.1은
서버 자기 자신만 가리켜서, 시그널링(참가·상대 목록)은 성공한 것처럼 보여도 실제 오디오는
조용히 안 들립니다.

```bash
MEDIASOUP_ANNOUNCED_ADDRESS=203.0.113.10 npm run deploy -- realtime-media-gateway
VITE_MEDIA_GATEWAY_URL=ws://203.0.113.10:4000 npm run deploy -- web
```

RTC 포트(`MEDIA_GATEWAY_RTC_PORT`, 기본 44444)는 시그널링 포트와 달리 리버스 프록시를 거칠 수
없습니다 — 브라우저가 이 포트로 직접 UDP·TCP 연결을 맺어야 하므로, 방화벽·보안 그룹에서 이
포트를 직접 열어둬야 합니다.

## 검증

```bash
pnpm build:realtime-chat
pnpm lint
pnpm format:check
```

## 라이선스

Copyright (C) 2026 changha lee, BlueCool12, chan0324

이 프로젝트는 [GNU Affero General Public License v3.0](LICENSE)으로 배포됩니다.

AGPL은 수정본을 **네트워크 서비스로 제공하는 경우에도** 소스 공개 의무가 발생합니다. 이 코드를
기반으로 서비스를 운영하려면 수정된 전체 소스를 동일 라이선스로 공개해야 합니다.
