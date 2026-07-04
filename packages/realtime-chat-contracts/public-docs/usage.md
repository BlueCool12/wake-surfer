# @wake-surfer/realtime-chat-contracts 사용법

데이터가 client, process, package boundary를 넘을 때만 이 패키지를 사용합니다.

허용되는 사용:

```ts
import type { SendChannelMessageRequest } from '@wake-surfer/realtime-chat-contracts';
```

이 패키지를 내부 domain model을 공유하는 보관소로 사용하지 않습니다. application command, usecase input, repository shape, runtime session state는 해당 behavior를 소유하는 feature package에 둡니다.

새 boundary payload를 추가할 때:

1. `src/socket`, `src/http`, `src/integration-events` 중 맞는 영역에 타입을 추가합니다.
2. `src/index.ts`에서 export합니다.
3. `public-docs/api.md`와 `public-docs/invariants.md`를 갱신합니다.
4. 이름은 내부 usecase command가 아니라 wire contract에 맞춥니다.
