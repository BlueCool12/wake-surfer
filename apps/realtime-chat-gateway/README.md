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
- 기본 포트: `3001`
- 기본 허용 Origin: `http://localhost:5173`

WebSocket upgrade는 설정된 path와 Origin이 모두 일치해야 한다. 브라우저가 사용자 지정 WebSocket
header를 보낼 수 없으므로 티켓은 query parameter로 받는다. 전체 연결과 동시 ticket 인증 대기에는
각각 별도 상한을 적용하고, ping/pong heartbeat로 응답하지 않는 연결을 정리한다.

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

`.env.example`을 기준으로 API와 같은 gateway token·gateway id를 설정한 뒤 실행한다.

```powershell
pnpm --filter @wake-surfer/realtime-chat-gateway build
pnpm --filter @wake-surfer/realtime-chat-gateway start
```

## 검증

```powershell
pnpm --filter @wake-surfer/realtime-chat-gateway typecheck
pnpm --filter @wake-surfer/realtime-chat-gateway test
```
