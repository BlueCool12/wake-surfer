# realtime-chat API 런타임 계약

이 문서는 realtime-chat API를 호출하거나 배포하는 소비자가 의존할 수 있는 공개 런타임 계약이다.
내부 미들웨어 구조와 구현 판단은 계약에 포함하지 않는다.

## 엔드포인트

| Method | Path | 의미 |
| --- | --- | --- |
| `GET` | `/health` | 이전 호환용 liveness 응답 |
| `GET` | `/health/live` | 프로세스가 요청을 처리할 수 있는지 확인 |
| `GET` | `/health/ready` | draining 상태가 아니고 DB 접근이 가능한지 확인 |
| `POST` | `/realtime-chat/gateway-tickets` | 인증된 actor의 일회성 gateway ticket 발급 |
| `POST` | `/internal/realtime-chat/gateway-tickets/consume` | 인증된 gateway의 ticket 소비 |

`/health/ready`는 준비되면 `200 { "status": "ready" }`, 준비되지 않으면
`503 { "status": "not_ready" }`를 반환한다. liveness는 DB 장애만으로 실패하지 않는다.

## 요청 경계

- 발급 본문은 없거나 빈 객체여야 한다. `actorId`, `userId`, `workspaceId`를 본문에서 받지 않는다.
- 소비 본문은 `{ "ticket": "..." }`만 허용한다. `gatewayId`를 본문에서 받지 않는다.
- 현재 actor와 gateway identity는 신뢰 경계가 덮어쓰는 설정 가능한 헤더에서 읽는다. 이 헤더를
  인터넷 클라이언트가 직접 지정할 수 있도록 노출하면 안 된다.
- JSON 요청의 공통 wire 상한은 코드 계약인 65,536 UTF-8 byte다. 배포 설정으로 바꿀 수 없으며,
  상한을 넘으면 `413`을 반환한다. endpoint별 schema는 이보다 작은 상한을 추가로 둘 수 있다.
- `REALTIME_CHAT_REQUEST_TIMEOUT_MS`는 gateway ticket 발급·소비, Message Send와 Stream Messages
  handler에 적용한다. 제한을 넘으면 `503`을 반환하되 오류 코드는 각 기능 계약을 따른다. 상태 확인
  endpoint에는 적용하지 않는다.
- 상태 변경 SQL은 요청 제한보다 짧은 PostgreSQL 연결 획득·statement timeout을 사용한다. API는
  `REALTIME_CHAT_OPERATION_ABORT_MS`가 지나면 새로운 ticket 저장·소비 SQL을 시작하지 않는다.

## 공통 헤더

- 유효한 요청에는 `x-request-id` 응답 헤더를 제공한다.
- 유효한 `x-request-id` 요청 헤더가 있으면 같은 값을 사용하며 최대 길이는 128자다. 헤더가 없으면
  UUID를 만든다. 잘못된 값은 새 ID로 바꾸지 않고 `400`으로 거절한다.
- 브라우저 CORS는 `REALTIME_CHAT_CORS_ALLOWED_ORIGINS`에 명시된 origin에만 적용한다.
- API는 기본 보안 응답 헤더를 제공한다.

## 종료 의미

종료 신호를 받으면 readiness가 먼저 내려간다. 새 배포 트래픽이 제거된 뒤 기존 HTTP 요청을
drain하고, `REALTIME_CHAT_SHUTDOWN_GRACE_MS`를 넘으면 남은 연결을 강제로 종료한다.

## 운영 설정

아래 설정은 모두 필수다. 누락되거나 형식·범위·상호 제약이 맞지 않으면 HTTP listener와 DB pool을
열기 전에 시작에 실패한다. 코드 기본값은 없다. `team-internal` 열은 개발자 3명이 사용하는 현재
내부 배포 예시이며 프레임워크 기본값이 아니다.

| 설정 | `team-internal` 예시 | 의미 |
| --- | --- | --- |
| `NODE_ENV` | `development` | Node 실행 환경과 production 보안 검증 모드 |
| `HOST` | `127.0.0.1` | HTTP listen 주소 |
| `PORT` | `3000` | HTTP listen port |
| `LOG_LEVEL` | `info` | Pino log level |
| `REALTIME_CHAT_CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | 쉼표로 구분한 브라우저 허용 origin |
| `REALTIME_CHAT_OPERATION_ABORT_MS` | `8000` | ticket 상태 변경을 새로 시작할 수 있는 제한 시간 |
| `REALTIME_CHAT_REQUEST_TIMEOUT_MS` | `10000` | 기능 HTTP handler의 Hono 응답 제한 시간 |
| `REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS` | `5000` | HTTP header 수신 제한 시간 |
| `REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS` | `12000` | 전체 HTTP request 수신 완료 제한 시간 |
| `REALTIME_CHAT_HTTP_KEEP_ALIVE_TIMEOUT_MS` | `5000` | 유휴 keep-alive 연결 제한 시간 |
| `REALTIME_CHAT_SHUTDOWN_GRACE_MS` | `10000` | 종료 drain 유예 시간 |
| `REALTIME_CHAT_DATABASE_URL` | Compose 개발 DB URL | PostgreSQL 접속 문자열 |
| `REALTIME_CHAT_POSTGRES_CONNECTION_TIMEOUT_MS` | `2000` | DB 연결 획득 제한 시간 |
| `REALTIME_CHAT_POSTGRES_STATEMENT_TIMEOUT_MS` | `5000` | SQL 실행 제한 시간 |
| `REALTIME_CHAT_POSTGRES_IDLE_TIMEOUT_MS` | `30000` | 유휴 DB connection 유지 시간 |
| `REALTIME_CHAT_POSTGRES_POOL_MAX` | `10` | 프로세스당 DB connection 상한 |
| `REALTIME_CHAT_POSTGRES_MAX_LIFETIME_SECONDS` | `300` | DB connection 최대 수명 |
| `REALTIME_CHAT_GATEWAY_ID` | `gateway-1` | 허용하는 gateway 식별자 |
| `REALTIME_CHAT_GATEWAY_URL` | `ws://localhost:3001/realtime-chat` | 발급 ticket이 가리키는 gateway URL |
| `REALTIME_CHAT_GATEWAY_API_TOKEN` | 32 UTF-8 byte 이상 비밀값 | 내부 API Bearer credential |
| `REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY` | `development` | 내부 구간 TLS 보장 방식 |
| `REALTIME_CHAT_ACTOR_AUTH_SECURITY` | `development` | actor trusted-edge 보장 방식 |
| `REALTIME_CHAT_GATEWAY_TICKET_TTL_MS` | `60000` | 일회성 gateway ticket 유효 시간 |
| `REALTIME_CHAT_GATEWAY_TICKET_RAW_BYTES` | `32` | ticket 난수 byte 수 |
| `REALTIME_CHAT_ACTOR_ID_HEADER` | `x-actor-id` | trusted edge가 제공하는 actor header |
| `REALTIME_CHAT_GATEWAY_ID_HEADER` | `x-gateway-id` | trusted edge가 제공하는 gateway header |
| `REALTIME_CHAT_GATEWAY_ASSERTED_ACTOR_HEADER` | `x-realtime-chat-actor-id` | gateway가 내부 요청에 전달하는 actor header |

PostgreSQL 연결 획득과 statement 제한 시간의 합은 operation 제한보다 짧고, operation 제한은 Hono
응답 제한보다 짧아야 한다. 이 축은 처리 작업의 예산이다. Node HTTP header/request/keep-alive 값은
느린 클라이언트와 연결 점유를 제한하는 별도 축이며, `REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS`는 handler
응답 전체를 감싸는 outer deadline이 아니다. header 수신 제한만 전체 request 수신 제한을 넘을 수 없다.

## 고정 계약과 배포 프로필

- 요청 본문 65,536 UTF-8 byte 상한은 대표적인 Message Send 필드 조합에서 8,192-byte text가
  최악의 JSON escape로 확장되는 경우를 수용하기 위한 코드 불변값이다. 이전
  `REALTIME_CHAT_REQUEST_BODY_LIMIT_BYTES`를 설정하면 조용히 무시하지 않고 시작에 실패한다.
- `.env.example`은 `team-internal` 필수 설정의 실행 예시일 뿐 fallback 제공자가 아니다.
- 내부 예시는 development credential과 임시 trusted header를 사용하므로 loopback에만 bind한다.
  외부 interface bind는 실제 secret, trusted edge와 TLS 경계를 함께 준비한 배포에서 명시적으로
  override한다.
- 외부 시연(`showcase`)은 별도 배포 환경과 secret에서 모든 필수 값을 명시한다. 내부 팀 값을
  암묵적으로 상속하지 않는다.
- 고객 운영 값은 잠재 고객 규모, SLO와 부하 측정 이후 별도로 결정한다.
- 프로필 선택 분기를 애플리케이션 코드에 두지 않는다. 같은 artifact에 배포별 env를 주입한다.
