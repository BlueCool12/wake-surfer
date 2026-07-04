# @wake-surfer/realtime-chat-contracts

프로세스 경계와 클라이언트 경계를 넘는 realtime chat 공개 계약 패키지입니다.

consumer는 package root에만 의존합니다.

```ts
import type {
  RealtimeChatClientEvent,
  MessageCommandResponse,
  OutboundMessageDeliveryRequested
} from '@wake-surfer/realtime-chat-contracts';
```

이 패키지는 DTO, socket event, integration event, 공개 primitive alias, 공개 error code만 포함합니다. feature-private command, usecase input, domain model, repository, runtime state는 포함하지 않습니다.

공개 계약 상세 문서는 다음 경로에 둡니다.

- `packages/realtime-chat-contracts/public-docs/api.md`
- `packages/realtime-chat-contracts/public-docs/usage.md`
- `packages/realtime-chat-contracts/public-docs/invariants.md`
- `packages/realtime-chat-contracts/public-docs/integration.md`

`src/**` deep import는 금지합니다. 내부 파일 배치는 consumer contract가 아닙니다.
