# @wake-surfer/realtime-chat

Realtime chat feature 구현 패키지입니다.

이 패키지는 chat feature의 HTTP API adapter, WebSocket gateway adapter, application usecase, domain policy, runtime port contract를 함께 소유합니다. app은 process bootstrap과 concrete infra wiring만 맡고, chat command/usecase/handler/session routing 내부 구현은 이 패키지 안에 둡니다.

consumer는 package root 또는 명시적 subpath에만 의존합니다.

```ts
import { mountRealtimeChatApi, mountRealtimeChatGateway } from "@wake-surfer/realtime-chat";
```

세부 public surface를 분리해서 보고 싶으면 다음 subpath를 사용합니다.

```ts
import { mountRealtimeChatApi } from "@wake-surfer/realtime-chat/api";
import { mountRealtimeChatGateway } from "@wake-surfer/realtime-chat/gateway";
```

공개 계약 상세 문서는 다음 경로에 둡니다.

- `packages/realtime-chat/public-docs/api.md`
- `packages/realtime-chat/public-docs/usage.md`
- `packages/realtime-chat/public-docs/invariants.md`
- `packages/realtime-chat/public-docs/integration.md`

`src/api/**`, `src/gateway/**`, `src/application/**`, `src/domain/**` 내부 deep import는 금지합니다. package root와 public subpath만 consumer contract입니다.
