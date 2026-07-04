# @wake-surfer/realtime-chat 공개 API

consumer는 package root 또는 public subpath에서만 import합니다.

```ts
import {
  mountRealtimeChatApi,
  mountRealtimeChatGateway,
  type RealtimeChatApiRuntimeDeps,
  type RealtimeChatGatewayRuntimeDeps
} from '@wake-surfer/realtime-chat';
```

API adapter 전용 public surface:

```ts
import {
  mountRealtimeChatApi,
  type RealtimeChatApiRuntimeDeps,
  type RealtimeChatApiMountOptions,
  type HttpServerLike
} from '@wake-surfer/realtime-chat/api';
```

Gateway adapter 전용 public surface:

```ts
import {
  mountRealtimeChatGateway,
  type RealtimeChatGatewayRuntimeDeps,
  type RealtimeChatGatewayMountOptions,
  type WebSocketServerLike
} from '@wake-surfer/realtime-chat/gateway';
```

공개 export:

| 내보내기 | 목적 |
| --- | --- |
| `mountRealtimeChatApi` | 프레임워크 중립 HTTP server에 realtime chat API route 전체 등록 |
| `mountRealtimeChatGateway` | 프레임워크 중립 WebSocket server에 realtime chat gateway route 등록 |
| `RealtimeChatApiRuntimeDeps` | API side infra dependency contract |
| `RealtimeChatGatewayRuntimeDeps` | Gateway side infra dependency contract |
| `HttpServerLike` | 최소 HTTP adapter contract |
| `WebSocketServerLike` | 최소 WebSocket adapter contract |

API route semantics:

| 메서드 | `basePath` 아래 suffix | 목적 |
| --- | --- | --- |
| `POST` | `/gateway-tickets` | gateway ticket 발급 |
| `POST` | `/internal/messages/channel` | channel message request DTO 처리 |
| `POST` | `/internal/messages/dm` | DM message request DTO 처리 |
| `POST` | `/internal/messages/thread-replies` | thread reply request DTO 처리 |
| `POST` | `/internal/read-cursors` | read cursor 전진 |
| `GET` | `/streams/:streamId/messages` | stream message sync |
| `POST` | `/internal/system-messages/session-started` | collaboration session system message 생성 |

Gateway socket semantics:

- ticket은 query `ticket` 또는 header `x-gateway-ticket`에서 읽습니다.
- connection 성공 시 `gateway.connected`를 보냅니다.
- malformed client message에는 `gateway.error`를 보냅니다.
- accepted/rejected message API response는 socket event로 relay합니다.
- outbound delivery event는 recipient user의 local session에만 push합니다.
