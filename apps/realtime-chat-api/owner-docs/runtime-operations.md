# realtime-chat API 런타임 운영 설계

## 구현 원칙

- 런타임은 함수와 명시적 의존성으로 조립한다.
- 서비스와 미들웨어를 클래스 상속 구조로 만들지 않는다.
- 변경 가능한 상태는 `createRealtimeChatApiApp()`과 `main.ts`의 런타임 경계에서만 소유한다.
- 오류는 클래스 계층 대신 태그된 오류 생성 함수와 타입 가드로 분류한다.
- 프레임워크가 요구하는 `HTTPException`은 Hono 경계에서만 사용한다.

## 미들웨어 순서

```text
request ID
→ 보안 헤더
→ Pino 접근 로그
→ 외부 경로 CORS
→ route별 본문 크기 제한
→ route별 handler 시간 제한
→ actor 또는 gateway 인증
→ 계약 schema 검증
→ 유스케이스 호출
→ 공통 오류 응답
```

접근 로그는 요청 본문, ticket, 인증 헤더, 전체 query string을 기록하지 않는다. 기본 필드는
`requestId`, `method`, `path`, `status`, `durationMs`다.

## 시간 제한 계층

- Hono handler timeout은 클라이언트 응답 시간을 제한한다.
- Node HTTP timeout은 느린 헤더와 오래 열린 HTTP 연결을 제한한다.
- PostgreSQL connection timeout은 연결 획득 시간을 제한한다.
- DB statement timeout은 아직 별도 후속 작업이다. handler timeout만으로 진행 중인 DB 쿼리가 자동
  취소된다고 가정하지 않는다.

## 상태 확인과 종료

- liveness는 프로세스 생존만 확인한다.
- readiness는 draining 여부와 DB 쿼리 가능 여부를 확인한다.
- 종료 신호를 받으면 `isShuttingDown`을 먼저 바꿔 readiness를 내린다.
- HTTP server close가 유예 시간 안에 끝나지 않으면 남은 연결을 강제로 닫는다.
- HTTP drain 뒤 DB pool을 닫는다.

## 인증 경계

현재 trusted header 방식은 임시 조립점이다. 공개 네트워크에서 헤더 값을 그대로 신뢰하지 않는다.
최종 actor 인증은 JWT/JWKS 검증 뒤 actor mapping을 수행하는 함수형 미들웨어로 교체한다. gateway
서비스 인증은 mTLS, 서명된 서비스 토큰 또는 인증 프록시 중 배포 구조와 함께 결정한다.

## 후속 작업

- 다중 인스턴스 분산 rate limit
- DB statement timeout과 요청 취소 전파
- metric backend와 tracing exporter
- 최종 actor 및 gateway 서비스 인증
