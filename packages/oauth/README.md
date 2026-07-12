# @wake-surfer/oauth

GitHub OAuth 기반 로그인/회원가입 플로우를 제공하고, 인증 완료 시 우리 서비스의 자체 인증 수단(세션/JWT)을 발급하는 패키지입니다.

- **순수 로직 계층**입니다. `process.env`나 웹 프레임워크에 의존하지 않으며, 설정값(config)과 저장소(port 구현)는 이 패키지를 쓰는 `apps/` 서버가 주입합니다.
- **위치(auth 도메인 관점):** 넓게 보면 인증(auth) 도메인 — 사용자가 누구인지 확인하고(Identity) 로그인 상태를 유지하는(Session) 영역 — 이 있고, GitHub OAuth는 그 **로그인 수단 하나**입니다. 이 패키지는 "GitHub OAuth" 부분을 소유하며, 사용자·세션 같은 인증 도메인 모델 자체를 여기서 정의하지는 않습니다. (auth 중심 재설계는 별도 이슈에서 논의)

```ts
import { createOAuthUsecases, createCookieStateStore } from "@wake-surfer/oauth";
```

## 구현 단계

GitHub OAuth 전체 플로우를 아래 단계로 나눠 완성합니다. 단계는 기능 단위이며, 이슈/PR은 인접 단계를 묶을 수 있습니다. (예: 3·4단계 → 하나의 PR) 각 단계의 구현 상세는 해당 PR이 올라올 때 아래 [단계별 상세](#단계별-상세)에 덧붙입니다.

- [x] **1. 로그인 진입점** — CSRF state 발급/저장 + GitHub authorize URL 생성 (이슈 #5)
- [x] **2. 콜백 & code 수신** — 콜백 처리 + state 검증 배선 + 인증 거부/에러 분기 (이슈 #27)
- [x] **3. access token 교환** — authorization code → GitHub access token
- [x] **4. GitHub 사용자 정보 조회** — access token으로 사용자(id·email 등) 조회
- [ ] **5. 사용자 계정 생성/조회** — GitHub 사용자 → 우리 DB 사용자 매핑 (이메일 충돌 정책 포함)
- [ ] **6. 세션/토큰 발급** — 우리 서비스 자체 세션/JWT 발급
- [ ] **7. 로그아웃** — 세션/토큰 만료·폐기

## 패키지 구조

```
src/
├── domain/                 # 순수 도메인 (기술 비의존)
│   ├── oauth-config.ts          # OAuthConfig 값 객체 + 검증
│   ├── oauth-csrf-state.ts      # CSRF state 발급 (CSPRNG)
│   └── oauth-provider-error.ts  # 프로바이더 원본 에러 형태 + 검역 규칙 (RFC 6749)
├── application/            # 유스케이스 오케스트레이션
│   ├── create-usecases.ts
│   ├── start-github-login.usecase.ts         # 1단계: 로그인 진입점
│   ├── handle-github-callback.usecase.ts     # 2단계: 콜백 처리
│   └── fetch-github-user-by-code.usecase.ts  # 3·4단계: 토큰 교환 + 사용자 조회
├── infrastructure/        # 어댑터 (port 구현·외부 프로바이더)
│   ├── cookie/               # signed 쿠키 기반 state 저장 어댑터
│   └── github/               # GitHub 규격 (authorize URL, 콜백 파싱, 토큰 교환, 사용자 조회)
├── runtime-deps.ts        # app이 주입하는 port 계약 (OAuthCsrfStateStorePort 등)
├── public.ts              # 공개 표면 선별
└── index.ts               # package root export
```

## 공개 API (주요)

| export                           | 용도                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| `createOAuthUsecases(config)`    | 부팅 시 config를 주입해 유스케이스 묶음 생성                   |
| `createCookieStateStore(config)` | signed httpOnly 쿠키 기반 `OAuthCsrfStateStorePort` 기본 구현  |
| `assertValidOAuthConfig(config)` | 부팅 시점 config 사전 검증                                     |
| `OAuthConfig`                    | GitHub OAuth App 설정값 타입                                   |
| `OAuthCsrfStateStorePort`        | app(또는 어댑터)이 구현해 주입하는 state 저장 계약             |
| `HandleGithubCallbackResult`     | 콜백 처리 결과 유니언 (`ok`+code 또는 `rejected`+reason)       |
| `OAuthCallbackErrorCode`         | 콜백 거부 사유 코드                                            |
| `OAuthProviderError`             | GitHub이 보낸 원본 에러 (로깅용 — 화면 렌더링 금지)            |
| `FetchGithubUserByCodeResult`    | GitHub 통신 결과 유니언 (`ok`+user 또는 `rejected`+reason)     |
| `GithubUser`                     | GitHub 사용자 정보 (id·login·email — email은 항상 존재)        |

전체 목록은 [`src/public.ts`](src/public.ts)가 기준입니다.

## 단계별 상세

### 1. 로그인 진입점 (이슈 #5)

"GitHub로 로그인" 버튼을 눌렀을 때 사용자를 GitHub 인증 페이지로 보내기까지를 담당합니다.

```
[로그인 버튼] → ①state 발급 → ②state 저장 → ③authorize URL 생성 → [GitHub로 302]
```

담은 것:

- CSRF 방지용 state 발급 (crypto-random 32바이트 이상, base64url)
- state 저장/검증 **계약(port)** 정의 + signed httpOnly 쿠키 기본 구현
- GitHub authorize URL 조립 (client_id / redirect_uri / scope / state)

> state를 **검증**하는 `verify()` 로직 자체는 여기서 제공하지만, 그것을 실제 콜백 요청에서 호출·거부 처리하는 배선은 2단계에서 담당합니다.

**사용 흐름 (apps에서의 배선)**

```ts
// 1) 부팅 시 1회: 앱-정적 config 주입
const oauth = createOAuthUsecases({
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!, // 토큰 교환용 (authorize URL에는 안 실림)
  redirectUri: process.env.GITHUB_REDIRECT_URI!,
  scopes: ["user:email"],
});

// 2) 요청마다: req/res에 바인딩된 쿠키 StateStore를 만들어 넘김
const stateStore = createCookieStateStore({
  cookies: /* 프레임워크 req/res 어댑터 */,
  secret: process.env.OAUTH_STATE_SECRET!,
});
const { authorizeUrl } = await oauth.startGithubLogin(stateStore);

// 3) 반환된 authorizeUrl로 302 리다이렉트
```

### 2. 콜백 & code 수신 (이슈 #27)

GitHub 인증 후 콜백으로 돌아온 요청을 검증하고, 다음 단계(토큰 교환)의 입력인 code를 확보합니다.

```
[GitHub 콜백] → ①쿼리 파싱 → ②error 분기 → ③state 검증(소비) → ④code 확인 → { ok, code }
```

담은 것:

- 콜백 쿼리(`code`/`state`/`error`/`error_description`) 파싱 — 중복(배열)·비문자열 값은 없는 것으로 취급 (parameter pollution 방어)
- error 계열 값 검역 — `error`는 OAuth 규격 토큰 형식(`snake_case`, 64자 이내)만, `error_description`은 인쇄 가능 ASCII 256자 이내 + HTML 위험 문자(`<>&"'` 등) 배제. 규격 밖 값은 조작된 입력으로 보고 없는 것으로 취급 (XSS 심층 방어)
- state 검증 배선 — 1단계의 `OAuthCsrfStateStorePort.verify` 호출, 미일치 시 거부 (재사용 차단 포함)
- 인증 거부/에러 분기 — 실패는 예외가 아닌 **결과 유니언**으로 반환

```ts
type HandleGithubCallbackResult =
  | { status: "ok"; code: string }
  | {
      status: "rejected";
      reason: "ACCESS_DENIED" | "PROVIDER_ERROR" | "MISSING_STATE" | "STATE_MISMATCH" | "MISSING_CODE";
      providerError?: { error: string; errorDescription?: string }; // GitHub 원본 보존
    };
```

> HTTP 상태코드·사용자 문구 매핑은 이 패키지가 아닌 apps의 책임입니다.
> 콜백에 도달한 시도의 state는 **결과와 무관하게 항상 소진**됩니다. (1회용 원칙, 전 경로 일관)
> ⚠️ `providerError`는 검역된 외부 입력입니다 — 로깅용으로만 쓰고 화면에 직접 렌더링하지 마세요.

**사용 흐름 (apps에서의 배선)**

```ts
// 콜백 라우트에서: 요청 쿠키에 바인딩된 stateStore + 쿼리를 그대로 전달
const result = await oauth.handleGithubCallback(stateStore, req.query);

if (result.status === "ok") {
  // result.code로 GitHub 사용자 조회 (3·4단계 참고)
  const github = await oauth.fetchGithubUserByCode(result.code);
} else {
  // result.reason별 에러 응답 매핑 (예: ACCESS_DENIED → 로그인 취소 안내)
}
```

### 3·4. access token 교환 & 사용자 정보 조회

콜백에서 확보한 code를 GitHub access token으로 교환하고, 그 토큰으로 사용자 정보를 조회합니다.
두 단계는 하나의 유스케이스(`fetchGithubUserByCode`)로 제공됩니다.

```
[code] → ①토큰 교환(POST /login/oauth/access_token) → ②사용자 조회(GET /user)
                                                        └ email 비공개면 GET /user/emails
       → { ok, user: { id, login, email } }
```

담은 것:

- code → access token 교환 — GitHub이 잘못된 code에도 HTTP 200 + body error로 응답하는 함정 대응
- 사용자 정보(id·login·email) 조회 — 응답 타입 검증, User-Agent 헤더 필수 대응
- 이메일 확보 — 프로필 email 우선, 비공개면 `/user/emails`의 primary·verified 선택,
  끝내 없으면 `EMAIL_UNAVAILABLE` (앱에서 "GitHub 이메일 인증 후 재시도" 안내 가능)
- access token은 결과로 노출하지 않고 내부에서 사용 후 폐기
- fetch 주입 가능(기본 내장 fetch), 타임아웃 기본 10초 — 네트워크·타임아웃 예외는 전파

```ts
type FetchGithubUserByCodeResult =
  | { status: "ok"; user: { id: number; login: string; email: string } }
  | {
      status: "rejected";
      reason: "TOKEN_EXCHANGE_FAILED" | "USER_FETCH_FAILED" | "EMAIL_UNAVAILABLE";
      providerError?: { error: string; errorDescription?: string }; // 토큰 교환 실패 시 원본 보존
    };
```

**사용 흐름 (apps에서의 배선)**

```ts
// 콜백에서 code를 확보한 뒤:
const github = await oauth.fetchGithubUserByCode(code);

if (github.status === "ok") {
  // github.user(id·login·email)로 계정 매핑 → JWT 발급 (다음 단계)
} else {
  // TOKEN_EXCHANGE_FAILED: 로그인 재시도 안내
  // EMAIL_UNAVAILABLE: GitHub 이메일 인증 안내
}
```

> 이후 단계(5~7)의 상세는 각 PR과 함께 이 아래에 추가합니다.

---

deep import(`@wake-surfer/oauth/src/**`)는 하지 않습니다. package root export만 consumer contract입니다.
