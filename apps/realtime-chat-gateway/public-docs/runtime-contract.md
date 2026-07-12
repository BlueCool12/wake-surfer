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
- 사용자 지정 헤더를 쓸 수 있는 클라이언트는 `REALTIME_CHAT_GATEWAY_TICKET_HEADER`도 사용할 수 있다.
- ticket은 짧은 TTL과 일회성 소비를 전제로 한다. 프록시와 접근 로그는 ticket query를 기록하지 않거나
  가려야 한다.
- `REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS`가 설정되면 일치하는 `Origin`이 있는 upgrade만 허용한다.
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

## 연결 제한

| 설정 | 기본값 | 의미 |
| --- | ---: | --- |
| `REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS` | 빈 값 | 쉼표로 구분한 허용 origin |
| `REALTIME_CHAT_GATEWAY_MAX_PAYLOAD_BYTES` | `65536` | WebSocket frame payload 상한 |
| `REALTIME_CHAT_GATEWAY_MAX_CONNECTIONS` | `10000` | 프로세스 전체 연결 상한 |
| `REALTIME_CHAT_GATEWAY_MAX_PENDING_AUTHENTICATIONS` | `256` | 동시 ticket 인증 대기 상한 |
| `REALTIME_CHAT_GATEWAY_HEARTBEAT_INTERVAL_MS` | `30000` | ping 주기 |
| `REALTIME_CHAT_API_REQUEST_TIMEOUT_MS` | `3000` | ticket consume 제한 시간 |
| `REALTIME_CHAT_GATEWAY_SHUTDOWN_GRACE_MS` | `10000` | 종료 drain 유예 시간 |

Node HTTP 헤더, 요청, keep-alive 제한은 각각
`REALTIME_CHAT_GATEWAY_HTTP_HEADERS_TIMEOUT_MS`, `REALTIME_CHAT_GATEWAY_HTTP_REQUEST_TIMEOUT_MS`,
`REALTIME_CHAT_GATEWAY_HTTP_KEEP_ALIVE_TIMEOUT_MS`로 설정한다.

## 현재 범위

현재 공개 계약은 연결 수락과 ticket 인증까지다. 메시지 envelope, ACK, 재시도, outbound fan-out,
presence와 재연결 의미론은 아직 이 계약에 포함하지 않는다.
