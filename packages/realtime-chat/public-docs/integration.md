# @wake-surfer/realtime-chat 연동

API app 연동:

1. `HttpServerLike`를 구현하는 HTTP adapter를 만듭니다.
2. `RealtimeChatApiRuntimeDeps`에 맞는 concrete runtime dependency를 구성합니다.
3. listen 전에 `mountRealtimeChatApi(server, options, deps)`를 호출합니다.

Gateway app 연동:

1. `WebSocketServerLike`를 구현하는 WebSocket adapter를 만듭니다.
2. `RealtimeChatGatewayRuntimeDeps`에 맞는 concrete runtime dependency를 구성합니다.
3. listen 전에 `mountRealtimeChatGateway(server, options, deps)`를 호출합니다.

런타임 의존성은 app이 concrete adapter로 만들고, 이 패키지는 typed port로만 받습니다.

| 영역 | 주요 dependency |
| --- | --- |
| API side | `db`, `permissionPort`, `outboundEventBus`, `clock`, `idGenerator`, `logger`, `ticketHasher` |
| Gateway side | `chatApiClient`, `gatewayTicketPort`, `outboundEventBus`, `clock`, `idGenerator`, `logger`, `metrics` |

Gateway는 API internal command/usecase가 아니라 `RealtimeChatApiClientPort`를 통해 API와 integration합니다.
