# realtime-chat API 런타임 운영 설계

## 구현 원칙

- 런타임은 함수와 명시적 의존성으로 조립한다.
- 서비스와 미들웨어를 클래스 상속 구조로 만들지 않는다.
- 변경 가능한 상태는 `createRealtimeChatApiApp()`과 `main.ts`의 런타임 경계에서만 소유한다.
- 앱 HTTP 오류와 작업 deadline 오류를 명시적 타입 가드로 분류한다.
- 프레임워크가 요구하는 `HTTPException`은 Hono 경계에서만 사용한다.

## 설정 소유권과 시작 실패

- `src/config/env.ts`는 배포자가 선택하는 운영 값을 읽고 타입·범위·상호 제약을 검증하는 경계다.
- 운영 설정은 모두 필수 env다. 누락이나 빈 문자열을 코드 기본값으로 복구하지 않고 listener와 DB
  pool을 열기 전에 시작에 실패한다.
- `createRealtimeChatApiApp()`은 이미 검증된 operation/Hono 시간 예산을 필수 의존성으로 받는다.
  app factory가 운영 기본값을 다시 소유하지 않는다.
- 65,536 UTF-8 byte 요청 본문 상한은 배포별 튜닝 값이 아니라 wire 계약이므로
  `src/http/request-body-policy.ts`의 코드 상수로 소유한다. 대표적인 Message Send 필드 조합에서
  text 8,192 byte가 JSON 제어문자 escape로 확장되는 경우도 이 상한 안에 들어와야 한다.
- `.env.example`은 개발자 3명의 `team-internal` 필수 값 예시이며 앱 parser의 fallback이 아니다.
  루트 `pnpm dev:realtime-chat` 실행기만 이를 로컬 개발 배포 입력으로 명시적으로 읽는다. 외부 시연과
  고객 운영 배포는 별도 환경·secret에서 모든 값을 명시하며, 코드에 profile 분기를 추가하지 않는다.
- development credential과 임시 trusted header를 쓰는 내부 예시는 loopback에만 bind한다. 외부
  interface bind는 실제 secret, trusted edge와 TLS를 함께 구성한 배포에서만 명시한다.

## 미들웨어 순서

```text
보안 헤더
→ request ID
→ Pino 접근 로그
→ gateway Bearer 인증
→ 외부 경로 CORS
→ route별 본문 크기 제한
→ route별 요청·operation 시간 제한
→ actor 또는 gateway context 확인
→ Standard Schema 검증
→ 유스케이스 호출
→ 공통 오류 응답
```

접근 로그는 요청 본문, ticket, 인증 헤더, 전체 query string을 기록하지 않는다. 기본 필드는
`requestId`, `method`, `path`, `status`, `durationMs`다.

## 시간 제한 계층

시간 제한은 하나의 중첩 체인이 아니라 두 축으로 관리한다.

처리 작업 축:

- PostgreSQL connection timeout은 연결 획득을, statement timeout은 이미 실행 중인 SQL을 제한한다.
- 두 DB 예산의 합은 gateway ticket operation deadline보다 짧아야 한다.
- operation deadline은 Hono 기능 route timeout보다 짧아야 한다. 도달하면 `AbortSignal`을 중단하고
  gateway-ticket 패키지는 SQL 시작 직전에 신호를 다시 확인한다.
- Hono timeout은 gateway ticket, Message Send, Stream Messages handler 응답 시간을 제한한다.
  Message Send와 Stream Messages의 진행 중 DB 작업을 자동 취소한다고 가정하지 않는다.
- Gateway의 API client timeout은 API Hono timeout보다 길게 두어 API가 먼저 계약 오류를 응답할
  시간을 확보한다. 이 값은 Gateway 배포 설정의 책임이다.

느린 클라이언트·연결 점유 보호 축:

- Node `headersTimeout`은 header 수신을, `requestTimeout`은 request 전체 수신 완료를 제한한다.
- Node `requestTimeout`은 handler 응답 전체를 감싸는 outer deadline이 아니다.
- Node `keepAliveTimeout`은 응답 뒤 유휴 keep-alive 연결을 제한한다.
- header 수신 제한은 request 수신 제한을 넘을 수 없다. 이 축을 처리 작업 축과 숫자 순서만으로
  결합하지 않는다.

## 상태 확인과 종료

- liveness는 프로세스 생존만 확인한다.
- readiness는 draining 여부와 DB 쿼리 가능 여부를 확인한다.
- 종료 신호를 받으면 `isShuttingDown`을 먼저 바꿔 readiness를 내린다.
- HTTP server close가 유예 시간 안에 끝나지 않으면 남은 연결을 강제로 닫는다.
- HTTP drain 뒤 DB pool을 닫는다.

시작 로그는 적용된 숫자 예산, listen host/port, CORS origin, pool 크기와 security mode만 allowlist로
구조화한다. DB URL, Gateway URL과 Bearer token 원문은 기록하지 않는다.

## 인증 경계

현재 trusted header 방식은 임시 조립점이다. 공개 네트워크에서 헤더 값을 그대로 신뢰하지 않는다.
최종 actor 인증은 JWT/JWKS 검증 뒤 actor mapping을 수행하는 함수형 미들웨어로 교체한다. gateway
서비스 인증은 mTLS, 서명된 서비스 토큰 또는 인증 프록시 중 배포 구조와 함께 결정한다.

## 후속 작업

- 다중 인스턴스 분산 rate limit
- metric backend와 tracing exporter
- 최종 actor 및 gateway 서비스 인증
