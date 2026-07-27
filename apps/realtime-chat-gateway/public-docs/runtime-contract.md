# realtime-chat gateway 런타임 계약

이 문서는 브라우저 클라이언트, API 서버, 배포 환경이 gateway에 의존할 수 있는 공개 런타임 계약이다.

## 엔드포인트

| 종류 | Path | 의미 |
| --- | --- | --- |
| HTTP `GET` | `/health` | 이전 호환용 liveness 응답 |
| HTTP `GET` | `/health/live` | gateway 프로세스 생존 확인 |
| HTTP `GET` | `/health/ready` | 새 upgrade 수락 가능 여부 확인 |
| WebSocket | 설정된 `REALTIME_CHAT_GATEWAY_PATH` | realtime-chat 연결 |

draining 중 readiness는 `503 { "status": "not_ready" }`를 반환하고 새 WebSocket upgrade는 `503`으로
거절한다.

## WebSocket 연결

- 브라우저는 `?ticket=...` query parameter로 일회성 ticket을 전달한다.
- ticket은 짧은 TTL과 일회성 소비를 전제로 한다. 프록시와 접근 로그는 ticket query를 기록하지 않거나
  가려야 한다.
- `REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS`와 일치하는 `Origin`이 있는 upgrade만 허용한다.
- ticket 소비가 성공하기 전 연결은 인증 대기 상태이며 세션으로 계산하지 않는다.
- gateway가 API로 ticket을 소비할 때 생성한 `x-request-id`를 전달한다.

## 연결 종료

| Code | 의미 |
| ---: | --- |
| `4401` | ticket 부재 또는 거절 |
| `1011` | ticket API 장애 또는 인증 시간 초과 |
| `1013` | 인증 대기 연결이 너무 많음 |
| `1001` | 서버 종료 중 |

heartbeat에 응답하지 않는 연결은 정상 close handshake를 기다리지 않고 종료할 수 있다.

## 런타임 설정

Gateway는 운영 설정에 코드 기본값을 제공하지 않는다. 아래 환경 변수는 모두 필수이며, 하나라도
누락되거나 유효하지 않으면 서버를 열기 전에 시작에 실패한다.
`.env.example` 값은 현재 3인 내부 팀 사용을 위한 `team-internal` 배포 예시다. 외부 시연은 별도 배포
환경에서 값을 명시해야 하며, 이 예시를 고객 운영 용량 보장으로 해석하면 안 된다.

| 설정 | `team-internal` 예시 | 의미 |
| --- | ---: | --- |
| `NODE_ENV` | `development` | Node 실행 환경과 production 보안 검증 모드 |
| `HOST` | `127.0.0.1` | HTTP/WebSocket listen host |
| `PORT` | `3001` | HTTP/WebSocket listen port |
| `LOG_LEVEL` | `info` | Pino log level |
| `REALTIME_CHAT_GATEWAY_ID` | `gateway-1` | 이 프로세스의 Gateway 식별자 |
| `REALTIME_CHAT_GATEWAY_PATH` | `/realtime-chat` | WebSocket upgrade 경로 |
| `REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS` | `http://localhost:5173` | 쉼표로 구분한 허용 origin |
| `REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS` | `32` | 프로세스 전체 연결 상한 |
| `REALTIME_CHAT_GATEWAY_MAX_PENDING_AUTHENTICATIONS` | `8` | 동시 ticket 인증 대기 상한 |
| `REALTIME_CHAT_GATEWAY_HEARTBEAT_INTERVAL_MS` | `30000` | ping 주기 |
| `REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS` | `5000` | Gateway inbound Node HTTP header 제한 시간 |
| `REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS` | `10000` | Gateway inbound Node HTTP request 제한 시간 |
| `REALTIME_CHAT_GATEWAY_HTTP_KEEP_ALIVE_TIMEOUT_MS` | `5000` | Gateway inbound Node HTTP keep-alive 제한 시간 |
| `REALTIME_CHAT_GATEWAY_SHUTDOWN_GRACE_MS` | `5000` | 종료 drain 유예 시간 |
| `REALTIME_CHAT_API_BASE_URL` | `http://localhost:3000` | 내부 realtime-chat API 기준 URL |
| `REALTIME_CHAT_GATEWAY_API_TOKEN` | 32 UTF-8 byte 이상 비밀값 | 내부 API Bearer credential |
| `REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY` | `development` | 내부 구간 TLS 보장 방식 |
| `REALTIME_CHAT_API_GATEWAY_ID_HEADER` | `x-gateway-id` | API에 전달하는 Gateway 식별 header |
| `REALTIME_CHAT_API_ASSERTED_ACTOR_HEADER` | `x-realtime-chat-actor-id` | API에 전달하는 actor 식별 header |
| `REALTIME_CHAT_API_REQUEST_TIMEOUT_MS` | `12000` | Gateway→API client 요청 제한 시간 |

Gateway의 outbound API client 제한 시간은 API 서버의 ticket operation deadline과 Hono request
deadline보다 길게 설정해야 한다. API가 ticket 소비의 성공 또는 timeout 응답을 확정하기 전에
Gateway가 연결을 닫지 않도록 `team-internal`에서는 API의
`REALTIME_CHAT_OPERATION_ABORT_MS=8000`, `REALTIME_CHAT_REQUEST_TIMEOUT_MS=10000`보다 바깥인
`REALTIME_CHAT_API_REQUEST_TIMEOUT_MS=12000`을 사용한다. Gateway는 API 설정을 직접 읽지 않으므로 이
순서를 유지하는 책임은 두 앱의 배포 환경 변수 집합에 있다.

`REALTIME_CHAT_GATEWAY_HTTP_*`는 Gateway로 들어오는 Node HTTP 연결을 제한하는 별도 축이다. 이 값과
Gateway의 outbound API client 제한 시간 사이에는 중첩 시간 예산 관계를 두지 않는다.

WebSocket 수신 message payload 상한은 모든 프로필에 공통인 `65,536바이트`다. fragmented frame은
재조립된 message 전체 크기로 계산한다. 이는 임의의 큰 message로 인한 메모리 사용을 제한하는 wire
보호 계약이므로 환경 변수로 변경하지 않는다. 이전
`REALTIME_CHAT_GATEWAY_MAX_PAYLOAD_BYTES`를 설정하면 조용히 무시하지 않고 시작에 실패한다.

## 현재 범위

현재 인스턴스는 channel join, 메시지 전송·fan-out, Stream Messages sync를 지원한다. 다중 Gateway 간
fan-out, durable broker, ACK·재시도, presence와 재연결 의미론은 아직 이 계약에 포함하지 않는다.
