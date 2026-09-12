# @wake-surfer/realtime-chat-gateway

실시간 채팅의 단일 인스턴스 MVP WebSocket 게이트웨이다. API가 발급한 일회성 티켓을 소비해 actor를
확정하고, 로컬 세션과 channel 구독을 유지한다.

## 실행 경계

- `GET /health`
- `WS /realtime-chat?ticket=<one-time-ticket>`
- 기본 포트: `3001`
- 기본 허용 Origin: `http://localhost:5173`

WebSocket upgrade는 설정된 path와 Origin이 모두 일치해야 한다. 브라우저가 사용자 지정 WebSocket
header를 보낼 수 없으므로 티켓은 query parameter로 받는다.

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
- `chat.message.edit`: `EditMessageRequest`
- `chat.message.delete`: `DeleteMessageRequest`
- `chat.stream.sync`: `ChatStreamSyncEvent`

지원하는 server event:

- `gateway.connected`: 최신 `GatewayConnectedEvent`
- `gateway.not_ready`
- `chat.message.accepted`
- `chat.message.rejected`
- `chat.message.created`: flat `PublicMessage`
- `chat.message.edit.accepted`, `chat.message.edit.rejected`
- `chat.message.delete.accepted`, `chat.message.delete.rejected`
- `chat.stream.synced`
- `chat.stream.sync.rejected`
- `chat.stream.sync.failed`

메시지 전송은 `POST /internal/realtime-chat/messages`로 중계한다. 새 channel message만 같은 channel을
구독한 현재 인스턴스의 ready session에 fan-out한다. thread message는 송신자 accepted까지만 전달하며
신규 thread fan-out은 하지 않는다. 수정·삭제도 API에 중계하고 요청자에게 accepted/rejected 결과만
돌려준다. 기존 메시지를 반환한 멱등 재시도는 created를 재발행하지 않는다. 다중 Gateway 간 전달과
durable broker는 이 MVP의 범위가 아니다.

## 로컬 실행

`.env.example`을 기준으로 API와 같은 gateway token·gateway id를 설정한 뒤 실행한다.

```powershell
pnpm exec turbo run build --filter=@wake-surfer/realtime-chat-gateway
pnpm --filter @wake-surfer/realtime-chat-gateway start
```

## Docker 배포

이 앱의 `docker/`가 Gateway Compose·환경 파일·Dockerfile을 소유한다. 배포 스크립트가 호스트에서
TypeScript 검사와 esbuild 실행 번들을 생성한다. Dockerfile은 프로젝트 빌드와 의존성 설치 없이
사전 생성된 `dist/main.mjs`만 runtime image에 복사한다.

```bash
npm run deploy -- realtime-chat-gateway
docker compose logs -f realtime-chat-gateway
```

서비스 단독 배포는 API나 공용 인프라를 다시 만들지 않는다. Gateway의 내부 API 주소는
`http://realtime-chat-api:3000`, 브라우저 origin은 기본 `http://localhost:5173`이다.
