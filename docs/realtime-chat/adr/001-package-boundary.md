# ADR 001. realtime-chat package boundary 결정

## 상태

Accepted

## 날짜

2026-07-04

## 배경

`realtime-chat`은 이 프로젝트의 하나의 feature입니다. 앱 프로세스는 API와 WebSocket gateway로 나뉠 수 있지만, package 구현까지 `realtime-chat-api`와 `realtime-chat-gateway`로 나누면 같은 feature 변경이 여러 package boundary를 계속 넘게 됩니다.

주요 flow는 하나의 chat feature 흐름입니다.

```txt
client socket event
→ gateway adapter transport validation
→ public API DTO forwarding
→ API adapter request validation
→ API usecase/domain
→ outbound delivery event
→ gateway adapter local fan-out
```

이 흐름에서 socket payload, HTTP DTO, ACK shape, message persistence policy는 함께 바뀔 가능성이 큽니다. 따라서 API adapter와 Gateway adapter는 별도 package보다 하나의 feature package 내부 경계로 두는 편이 변경 여파와 문서 관리 비용을 줄입니다.

반대로 client/process boundary를 넘는 wire shape는 구현체와 분리된 public contract로 유지해야 합니다. Java에서 interface jar를 별도로 배포하는 것과 비슷한 역할입니다.

## 결정

package 구조는 다음을 기준으로 합니다.

```txt
packages/
  realtime-chat/
    = realtime chat feature 구현 전체
    = HTTP API adapter
    + WebSocket gateway adapter
    + application usecase
    + domain policy
    + runtime port contract

  realtime-chat-contracts/
    = process/client boundary를 넘는 공개 contract
    = socket event
    + HTTP DTO
    + outbound/integration event
    + public error code
```

`packages/realtime-chat-api`와 `packages/realtime-chat-gateway`는 만들지 않습니다. API/Gateway 분리는 package가 아니라 app/process와 package 내부 adapter 경계로 표현합니다.

public import는 다음 형태를 허용합니다.

```ts
import { mountRealtimeChatApi, mountRealtimeChatGateway } from "@wake-surfer/realtime-chat";
```

세부 adapter별 import가 필요하면 public subpath를 사용합니다.

```ts
import { mountRealtimeChatApi } from "@wake-surfer/realtime-chat/api";
import { mountRealtimeChatGateway } from "@wake-surfer/realtime-chat/gateway";
```

## contracts 분리 기준

`realtime-chat-contracts`에 둘 수 있는 것:

- socket event
- HTTP/process DTO
- outbound delivery event
- integration event
- public error code
- public primitive alias

`realtime-chat-contracts`에 두지 않는 것:

- package-private command
- usecase input
- domain model
- repository port
- gateway session registry
- persistence model

## 결과

이 결정으로 app과 package 책임은 다음처럼 나뉩니다.

```txt
apps/realtime-chat-api
  = API process bootstrap
  + HTTP server lifecycle
  + runtime dependency wiring
  + mountRealtimeChatApi 호출

apps/realtime-chat-gateway 또는 apps/realtime-gateway
  = Gateway process bootstrap
  + WebSocket server lifecycle
  + runtime dependency wiring
  + mountRealtimeChatGateway 호출

packages/realtime-chat
  = chat feature behavior
  + API/Gateway adapter boundary
  + port/interface

packages/realtime-chat-contracts
  = public wire contract
```

## 후속 작업

- app package가 생길 때 이 package boundary에 맞춰 runtime dependency를 주입합니다.
- `packages/realtime-chat`에 concrete app runtime dependency를 직접 추가하지 않습니다.
