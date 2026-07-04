# @wake-surfer/realtime-chat-gateway

Realtime chat WebSocket gateway process입니다.

이 앱은 `@wake-surfer/realtime-chat/gateway`를 마운트하는 얇은 composition root입니다. 소켓 이벤트 분기, 세션 레지스트리, ACK 변환, outbound fan-out은 package가 처리합니다.

## 실행 환경

필수 env:

```txt
HOST
PORT
NODE_ENV
LOG_LEVEL
REALTIME_CHAT_GATEWAY_PATH
GATEWAY_ID
REALTIME_CHAT_API_BASE_URL
MAX_PAYLOAD_BYTES
DATABASE_URL
```

`DATABASE_URL`은 gateway ticket atomic consume에 사용합니다. 실제 값은 `.env` 또는 프로세스 환경 변수로 주입합니다.

## 명령

```sh
pnpm --filter @wake-surfer/realtime-chat-gateway build
pnpm --filter @wake-surfer/realtime-chat-gateway test:smoke
```
