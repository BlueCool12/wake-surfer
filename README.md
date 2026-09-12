# wake-surfer

WebSocket, WebRTC, RTMP 등을 활용한 화상 회의, 실시간 협업, 페어 프로그래밍 플랫폼입니다.

## 개발 환경

```bash
pnpm install
```

### 빌드 실행

의존 패키지의 빌드 순서와 결과 캐시는 Turborepo가 관리합니다. 각 패키지의 `build`는 자기 코드만
컴파일하며, 앱의 배포용 번들도 같은 명령에서 생성합니다.

```bash
# 전체 앱과 패키지 빌드
pnpm build

# 웹과 웹이 사용하는 패키지만 빌드
pnpm exec turbo run build --filter=web

# 기존 채팅 개발용 빌드 범위
pnpm build:realtime-chat

# 실제 빌드 없이 실행 순서 확인
pnpm exec turbo run build --dry

# 해당 스크립트가 있는 패키지의 타입 검사와 테스트
pnpm typecheck
pnpm test
```

패키지의 `build`, `typecheck`, `test`, `dev`를 직접 호출하면 선행 작업은 실행되지 않습니다.
의존 패키지 준비가 필요한 작업은 `pnpm exec turbo run <작업> --filter=<패키지명>`으로 실행합니다.
예를 들어 웹 개발 서버는 `pnpm exec turbo run dev --filter=web`으로 시작할 수 있습니다.
선행 빌드는 시작할 때 실행되며, 공통 패키지 변경을 계속 감시하고 재빌드하는 기능은 별도입니다.

빌드 결과 `dist/`는 `.turbo/`의 로컬 캐시에서 복원합니다. 공통 TypeScript 설정, 공통 출력 스크립트,
환경 파일과 `NODE_ENV`·`VITE_*` 값이 바뀌면 관련 캐시도 무효화됩니다. 인증 API는 빌드·타입 검사·테스트·
개발 실행 전에 `prisma:generate`를 항상 실행해 `node_modules` 안의 생성 파일을 준비합니다.
테스트와 개발 서버 실행은 캐시하지 않습니다. 원격 캐시는 별도로 설정하지 않습니다.

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
npm run deploy -- auth-api
npm run deploy -- web
```

배포 스크립트는 선택한 앱들을 한 번의 Turbo 실행으로 빌드합니다. API·Gateway의 esbuild 실행 번들과
Web의 Vite 정적 번들은 호스트에서 만들거나 캐시에서 복원한 뒤 기존 Docker 배포 절차를 진행합니다.
Docker build context는 `Dockerfile.dockerignore`로 필요한 파일만 이미지 입력에 전달합니다.
`auth-api`는 workspace production 의존성과 Linux용 Prisma Client를 이미지 안에서 준비하고,
`realtime-media-gateway`는 mediasoup의 네이티브 `mediasoup-worker` 바이너리를 별도 빌드 스테이지에서
준비합니다.

서비스 상태와 로그는 루트 Compose에서 서비스 이름으로 확인합니다.

```bash
docker compose ps
docker compose logs -f realtime-chat-api
docker compose logs -f realtime-chat-gateway
docker compose logs -f realtime-media-gateway
docker compose logs -f auth-api
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
├─ apps/realtime-media-gateway/docker/compose.yml
├─ apps/auth-api/docker/compose.yml
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
PostgreSQL: postgresql://wake_surfer_realtime_chat:wake_surfer_realtime_chat_dev_password@localhost:5432/wake_surfer_realtime_chat?options=-c%20search_path%3Drealtime_chat%2Cpublic
Redis: redis://localhost:6379
```

기본 포트가 이미 사용 중이면 `REALTIME_CHAT_POSTGRES_PORT`, `REALTIME_CHAT_REDIS_PORT` 환경 변수로 호스트 포트를 바꿀 수 있습니다.

```powershell
$env:REALTIME_CHAT_POSTGRES_PORT = "15432"
$env:REALTIME_CHAT_REDIS_PORT = "16379"
pnpm docker:up
```

앱 공개 포트는 `REALTIME_CHAT_API_PORT`, `REALTIME_CHAT_GATEWAY_PORT`, `AUTH_API_PORT`,
`WAKE_SURFER_WEB_PORT`로
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

## PR 요약 (CodeRabbit)

PR을 열면 CodeRabbit이 변경사항을 자동으로 요약합니다.

- 확인 방법: 요약은 PR 설명이 아니라 CodeRabbit이 남기는 walkthrough 코멘트에서 확인합니다.
- Draft PR은 리뷰하지 않으며, Ready로 전환하면 실행됩니다. 이후 push할 때마다 요약이 갱신됩니다.
- 요약 코멘트에 멘션 없이 답글을 달아도 CodeRabbit이 이어서 답변합니다.
- 설정 변경: 저장소 루트 [`.coderabbit.yaml`](.coderabbit.yaml)을 수정합니다. 요약 형식, 리뷰 대상 브랜치, 제외 경로 등을 여기서 관리합니다.
- 전체 옵션은 [CodeRabbit 설정 문서](https://docs.coderabbit.ai/reference/configuration)를 참고합니다.

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
