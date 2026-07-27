# @wake-surfer/realtime-chat-gateway

실시간 채팅의 단일 인스턴스 MVP WebSocket 게이트웨이다. API가 발급한 일회성 티켓을 소비해 actor를
확정하고, 로컬 세션과 channel 구독을 유지한다.

배포·클라이언트가 의존할 수 있는 연결 제한, heartbeat, 상태 확인과 종료 의미는
`apps/realtime-chat-gateway/public-docs/runtime-contract.md`에 정의한다.

## 실행 경계

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `WS /realtime-chat?ticket=<one-time-ticket>`

WebSocket upgrade는 설정된 path와 Origin이 모두 일치해야 한다. 브라우저가 사용자 지정 WebSocket
header를 보낼 수 없으므로 티켓은 query parameter로 받는다. 전체 연결과 동시 ticket 인증 대기에는
각각 별도 상한을 적용하고, ping/pong heartbeat로 응답하지 않는 연결을 정리한다.

모든 운영 설정은 환경 변수로 명시해야 한다. 누락되거나 유효하지 않은 설정이 있으면 프로세스는
서버를 열기 전에 실패한다. `.env.example`의 포트 `3001`, 허용 Origin
`http://localhost:5173`, 연결 상한 `32`는 3인 내부 팀 사용을 위한 예시이지 코드 기본값이나 외부
운영 보장이 아니다. 외부 시연과 고객 운영은 배포 환경별 값을 따로 제공한다.

WebSocket 수신 message payload 상한 `65,536바이트`는 배포 프로필로 달라지지 않는 wire 보호
계약이며 환경 변수가 아닌 코드 상수로 고정한다. fragmented frame은 재조립된 message 전체 크기에
이 상한을 적용한다.

게이트웨이가 API를 호출할 때는 다음 서버 신뢰 정보를 직접 추가한다.

- `Authorization: Bearer <REALTIME_CHAT_GATEWAY_API_TOKEN>`
- `x-gateway-id` 또는 설정된 gateway identity header
- 메시지 전송 시 `x-realtime-chat-actor-id` 또는 설정된 asserted actor header

## Wire 형식

모든 text frame은 다음 flat JSON 형식이다.

```json
{
  "type": "event.name",
  "...": "event payload fields"
}
```

지원하는 client event:

- `chat.channel.join`: `{ channelId }`
- `chat.message.send`: `SendMessageRequest`
- `chat.stream.sync`: `ChatStreamSyncEvent`

지원하는 server event:

- `gateway.connected`: 최신 `GatewayConnectedEvent`
- `gateway.not_ready`
- `chat.message.accepted`
- `chat.message.rejected`
- `chat.message.created`: flat `PublicMessage`
- `chat.stream.synced`
- `chat.stream.sync.rejected`
- `chat.stream.sync.failed`

메시지 전송은 `POST /internal/realtime-chat/messages`로 중계한다. accepted message는 같은 channel을
구독한 현재 인스턴스의 ready session에 fan-out한다. 다중 Gateway 간 전달과 durable broker는 이 MVP의
범위가 아니다.

## 로컬 실행

`.env.example`의 모든 항목을 실행 환경에 명시하고, API와 같은 gateway token·gateway id를 설정한 뒤
실행한다. `.env.example` 자체는 앱의 런타임 fallback을 제공하지 않으며, 루트
`pnpm dev:realtime-chat` 실행기만 이를 로컬 `team-internal` 입력으로 명시적으로 읽는다. 예시는 알려진
개발 token과 `development` 보안 모드를 사용하므로 loopback에만 bind한다. 다른 인터페이스에
노출하려면 실제 token과 접근·전송 보안 경계를 함께 설정해야 한다.

```powershell
pnpm --filter @wake-surfer/realtime-chat-gateway build
pnpm --filter @wake-surfer/realtime-chat-gateway start
```

## 검증

```powershell
pnpm --filter @wake-surfer/realtime-chat-gateway typecheck
pnpm --filter @wake-surfer/realtime-chat-gateway test
```
