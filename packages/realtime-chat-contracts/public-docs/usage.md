# @wake-surfer/realtime-chat-contracts 사용법

데이터가 client, process, package boundary를 넘을 때만 이 패키지를 사용합니다.

허용되는 사용:

```ts
import type {
  RealtimeChatClientEvent,
  RealtimeChatServerEvent,
  SendChannelMessageRequest,
  MessageCommandResponse,
} from "@wake-surfer/realtime-chat-contracts";
```

금지되는 사용:

```ts
// 금지: 파일 배치는 public contract가 아닙니다.
import type { SendChannelMessageRequest } from "@wake-surfer/realtime-chat-contracts/src/http/message.dto";
```

이 패키지를 내부 domain model을 공유하는 보관소로 사용하지 않습니다. application command, usecase input, repository shape, runtime session state는 해당 behavior를 소유하는 feature package에 둡니다.

server-side policy나 deployment configuration에 해당하는 값은 request DTO에 넣지 않습니다. 예를 들어 gateway ticket TTL과 advertised gateway URL은 `@wake-surfer/realtime-chat` mount option에서 결정합니다.

## Client event 작성

client는 socket으로 `RealtimeChatClientEvent` union 중 하나를 JSON object로 보냅니다.

```ts
const event: RealtimeChatClientEvent = {
  type: "chat.channel.message.send",
  commandId: crypto.randomUUID(),
  clientMessageId: "local-1",
  workspaceId: "workspace-1",
  channelId: "channel-1",
  content: {
    kind: "text",
    text: "안녕하세요",
  },
  sentAtClient: new Date().toISOString(),
};
```

## HTTP DTO 작성

process boundary에서 API를 호출하는 consumer는 HTTP DTO를 사용합니다.

```ts
const request: SendChannelMessageRequest = {
  requestId: "command-1",
  actorId: "user-1",
  workspaceId: "workspace-1",
  channelId: "channel-1",
  clientMessageId: "local-1",
  content: {
    kind: "text",
    text: "안녕하세요",
  },
  sentAtClient: new Date().toISOString(),
};
```

새 boundary payload를 추가할 때:

1. `src/socket`, `src/http`, `src/integration-events` 중 맞는 영역에 타입을 추가합니다.
2. `src/index.ts`에서 root export합니다.
3. `public-docs/api.md`와 `public-docs/invariants.md`를 갱신합니다.
4. 이름은 내부 usecase command가 아니라 wire contract에 맞춥니다.
