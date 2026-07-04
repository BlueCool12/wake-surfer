# @wake-surfer/realtime-chat-contracts 연동

consumer는 보통 feature package를 통해 이 패키지를 사용합니다.

| 소비자 | 일반적인 사용 |
| --- | --- |
| `packages/realtime-chat` | API/Gateway adapter에서 HTTP DTO, socket event, outbound delivery event payload 사용 |
| frontend client | socket event와 HTTP DTO compile-time shape |
| app-owned API client adapter | Gateway `RealtimeChatApiClientPort` 구현 시 HTTP DTO request/response shape 사용 |
| app-owned broker adapter | outbound delivery event publish/subscribe payload shape 사용 |

Boundary 규칙:

```txt
external boundary shape -> @wake-surfer/realtime-chat-contracts
feature-private behavior -> owning feature package
server-side policy/deployment config -> owning feature package mount options
```

consumer가 API 또는 gateway feature package 내부 타입을 필요로 하더라도, 그 타입이 process/client boundary를 넘지 않는다면 이 패키지로 옮기지 않습니다.

Gateway ticket TTL과 advertised gateway URL은 public response 또는 feature mount configuration으로만 다루며, ticket issue request DTO가 override하지 않습니다.

## Mapping conventions

- socket client event `commandId`는 Gateway가 API DTO의 `requestId`로 mapping합니다.
- socket message event의 sender actor는 client payload가 아니라 consumed gateway session에서 결정됩니다.
- `OutboundMessageDeliveryRequested.payload`는 이미 `ChatMessageCreatedEvent`입니다. gateway consumer는 domain recipient를 다시 계산하지 않습니다.
- `CollaborationSessionStarted`는 integration event이고, feature package가 system message DTO/usecase로 변환합니다.

## Import boundary

지원되는 import path는 package root뿐입니다.

```ts
import type { OutboundMessageDeliveryRequested } from '@wake-surfer/realtime-chat-contracts';
```

`@wake-surfer/realtime-chat-contracts/src/**`와 파일별 subpath는 public integration point가 아닙니다.
