# @wake-surfer/auth-api

GitHub OAuth 로그인을 담당하는 서비스. `packages/oauth`의 유스케이스를 HTTP로 노출한다.

- 포트: **3002**
- 스택: NestJS + Prisma + PostgreSQL

## 라우트

| 라우트 | 설명 |
|---|---|
| `GET /health` | 헬스체크 |
| `GET /auth/github/login` | GitHub 인증 페이지로 리다이렉트 (+ state 쿠키) |
| `GET /auth/github/callback` | 콜백 처리 → JWT 쿠키 발급 → 프론트로 리다이렉트 |

로그인 실패는 `{WEB_ORIGIN}/login?error=<코드>`로 리다이렉트한다.
코드는 `denied`(사용자 거부) · `expired`(state 만료·재사용) · `failed`(통신 실패) ·
`no_email`(공개된 인증 이메일 없음) 넷이다.

## 준비

### 1. GitHub OAuth App 등록

https://github.com/settings/developers → New OAuth App

| 필드 | 값 |
|---|---|
| Homepage URL | `http://localhost:5173` |
| Authorization callback URL | `http://localhost:3002/auth/github/callback` |

콜백 URL은 `GITHUB_REDIRECT_URI`와 **정확히 일치**해야 한다.
OAuth App은 콜백을 하나만 등록할 수 있으므로 환경(local/staging/production)마다 앱을 따로 만든다.

### 2. 시크릿 생성

```bash
# state 쿠키 서명 키
openssl rand -base64 32

# RS256 키 쌍
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -in private.pem -pubout -out public.pem
```

PEM은 여러 줄이라 환경변수에 그대로 넣기 어렵다. **개행을 `\n`으로 이스케이프**해서 한 줄로 넣는다.

```bash
awk 'BEGIN{ORS="\\n"} {print}' private.pem
```

개인키는 이 서비스에만 둔다. 토큰을 검증하는 다른 서비스에는 **공개키만** 넘긴다.

### 3. `.env` 작성

`.env.example`을 복사해 값을 채운다. `.env`는 커밋하지 않는다.

### 4. DB 기동과 마이그레이션

```bash
docker compose -f docker/compose.yml up -d auth-postgres
pnpm --filter @wake-surfer/auth-api prisma:migrate
```

auth 전용 Postgres를 5433에 띄운다. 기존 realtime-chat DB(5432)와 분리돼 있다 —
그쪽은 Atlas가 관리하므로 Prisma Migrate와 섞으면 안 된다.

## 실행

```bash
pnpm exec turbo run build --filter=@wake-surfer/auth-api
pnpm --filter @wake-surfer/auth-api start
```

## Docker 배포

루트 배포 명령은 Turbo로 `auth-api`와 `oauth` 패키지를 먼저 빌드한 뒤 production 의존성과 Linux용
Prisma Client를 포함한 이미지를 생성합니다. 앱 환경 변수는 `apps/auth-api/.env`에서 읽고, 컨테이너의
DB 주소와 공개 포트는 Compose가 로컬 Docker 환경에 맞게 덮어씁니다.

```bash
npm run deploy -- auth-api
docker compose logs -f auth-api
```

`AUTH_API_PORT`, `AUTH_PUBLIC_WEB_ORIGIN`, `AUTH_GITHUB_REDIRECT_URI`로 로컬 공개 주소를 변경할 수 있습니다.

## 데이터 모델

회원(`users`)과 로그인 수단(`identities`)을 분리한다.
매핑 키는 `(provider, providerUserId)`이고 이메일은 유일키가 아니다.
나중에 다른 provider가 붙어도 `identities`에 한 줄만 추가하면 된다.
