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
- JSON 요청 크기는 `REALTIME_CHAT_REQUEST_BODY_LIMIT_BYTES`로 제한하며 초과 시 `413`을 반환한다.
- handler 시간 제한을 넘으면 `504`와 `gateway_ticket_unavailable` 오류 코드를 반환한다.

## 공통 헤더

- 모든 응답은 `x-request-id`를 제공한다.
- 유효한 `x-request-id` 요청 헤더가 있으면 같은 값을 사용하며 최대 길이는 128자다.
- 브라우저 CORS는 `REALTIME_CHAT_CORS_ORIGINS`에 명시된 origin에만 적용한다. 값이 비어 있으면 CORS
  헤더를 추가하지 않는다.
- API는 기본 보안 응답 헤더를 제공한다.

## 종료 의미

종료 신호를 받으면 readiness가 먼저 내려간다. 새 배포 트래픽이 제거된 뒤 기존 HTTP 요청을
drain하고, `REALTIME_CHAT_SHUTDOWN_GRACE_MS`를 넘으면 남은 연결을 강제로 종료한다.

## 운영 설정

| 설정 | 기본값 | 의미 |
| --- | ---: | --- |
| `REALTIME_CHAT_CORS_ORIGINS` | 빈 값 | 쉼표로 구분한 브라우저 허용 origin |
| `REALTIME_CHAT_REQUEST_BODY_LIMIT_BYTES` | `16384` | JSON 본문 상한 |
| `REALTIME_CHAT_HANDLER_TIMEOUT_MS` | `5000` | Hono handler 제한 시간 |
| `REALTIME_CHAT_HTTP_HEADERS_TIMEOUT_MS` | `5000` | HTTP 헤더 수신 제한 시간 |
| `REALTIME_CHAT_HTTP_KEEP_ALIVE_TIMEOUT_MS` | `5000` | 유휴 keep-alive 제한 시간 |
| `REALTIME_CHAT_HTTP_REQUEST_TIMEOUT_MS` | `10000` | Node HTTP 요청 제한 시간 |
| `REALTIME_CHAT_SHUTDOWN_GRACE_MS` | `10000` | 종료 drain 유예 시간 |

handler 제한 시간은 HTTP 요청 제한 시간보다 짧아야 하고, 헤더 제한 시간은 HTTP 요청 제한 시간을
넘을 수 없다.
