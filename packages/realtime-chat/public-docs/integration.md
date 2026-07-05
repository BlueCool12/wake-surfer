# @wake-surfer/realtime-chat 연동

## Composition root 책임

`apps/<service>`는 배포 단위이자 composition root입니다.

app이 소유하는 것:

- process startup, env parsing, listen/shutdown
- concrete HTTP/WebSocket framework 선택
- concrete DB, broker, permission, logger, metrics, API client 구현
- `HttpServerLike` 또는 `WebSocketServerLike` adapter 작성
- `RealtimeChatApiRuntimeDeps` 또는 `RealtimeChatGatewayRuntimeDeps` 구성

`@wake-surfer/realtime-chat`가 소유하는 것:

- API route suffix와 handler flow
- WebSocket connection/message routing
- request/socket payload validation
- DTO-to-command mapping
- permission/read/idempotency/domain policy orchestration
- gateway local session registry
- outbound delivery publish/fan-out

## API app 연동 순서

1. concrete HTTP framework를 생성합니다.
2. framework route 등록 API를 `HttpServerLike.route(definition)`으로 감쌉니다.
3. `RealtimeChatApiRuntimeDeps`에 맞는 concrete adapter를 구성합니다.
4. listen 전에 `mountRealtimeChatApi(server, options, deps)`를 호출합니다.

HTTP adapter 요구사항:

- `definition.method`와 `definition.path` 그대로 framework에 등록합니다.
- framework의 path parameter를 `request.params`로 전달합니다.
- query string을 `request.query`로 전달합니다.
- headers는 `request.headers`로 전달합니다. gateway ticket actor fallback을 쓰려면 `x-actor-id`를 전달해야 합니다.
- handler가 반환한 `{ status, body }`를 framework response로 변환합니다.

## Gateway app 연동 순서

1. concrete WebSocket framework를 생성합니다.
2. framework route 등록 API를 `WebSocketServerLike.route(definition)`으로 감쌉니다.
3. concrete socket을 `WebSocketConnectionLike`로 감쌉니다.
4. `RealtimeChatGatewayRuntimeDeps`에 맞는 API client, ticket consume port, outbound bus subscriber를 구성합니다.
5. listen 전에 `mountRealtimeChatGateway(server, options, deps)`를 호출합니다.

WebSocket adapter 요구사항:

- `definition.path` 그대로 framework에 등록합니다.
- connection query와 headers를 package connection handler에 전달합니다.
- inbound socket payload를 `onMessage` handler로 전달합니다.
- package가 보내는 string payload를 그대로 client에게 전송합니다.
- package가 호출한 close code/reason을 framework close API에 전달합니다.

## API/Gateway integration

Gateway는 API internal command/usecase를 직접 호출하지 않습니다. Gateway app은 `RealtimeChatApiClientPort`를 구현해 API app의 public HTTP DTO endpoint와 통신합니다.

| Gateway client method | 일반적인 HTTP route |
| --- | --- |
| `sendChannelMessage` | `POST /internal/messages/channel` |
| `sendDMMessage` | `POST /internal/messages/dm` |
| `replyThreadMessage` | `POST /internal/messages/thread-replies` |
| `markReadCursor` | `POST /internal/read-cursors` |
| `syncStreamMessages` | `GET /streams/:streamId/messages` |

`issueGatewayTicket`은 Gateway client port에 optional로 존재하지만, Gateway socket connect flow는 `gatewayTicketPort.consume(ticketValue)`를 사용합니다. app-owned `GatewayTicketConsumePort`는 일반적으로 `POST /internal/gateway-tickets/consume`을 호출합니다.

outbound delivery는 API app의 `OutboundEventBusPort.publish`와 Gateway app의 `OutboundEventBusPort.subscribe`를 같은 broker channel에 연결해 process boundary를 넘깁니다. 현재 app 구현은 Redis Pub/Sub channel을 사용합니다.

## Operational parameters

Gateway ticket TTL과 advertised gateway URL 같은 운영 파라미터는 API mount option으로 주입합니다. request DTO가 이를 override하지 않습니다.

| 값 | 주입 위치 | 기본값 |
| --- | --- | --- |
| gateway ticket TTL | `RealtimeChatApiMountOptions.gatewayTicketTtlSeconds` | `60` |
| advertised gateway URL | `RealtimeChatApiMountOptions.gatewayUrl` | 없음 |
| max text length | `RealtimeChatApiMountOptions.maxMessageTextLength` | `4000` |
| stream sync default limit | `RealtimeChatApiMountOptions.syncDefaultLimit` | `50` |
| stream sync max limit | `RealtimeChatApiMountOptions.syncMaxLimit` | `100` |
| max socket payload bytes | `RealtimeChatGatewayMountOptions.maxPayloadBytes` | `65536` |

## Lifecycle

현재 mount 함수는 둘 다 `Promise<void>`를 반환합니다. 별도 mounted handle 또는 dispose handle은 public API에 없습니다.

Gateway mount는 내부에서 `deps.outboundEventBus.subscribe(...)`를 호출합니다. app shutdown에서 구독 해제가 필요하다면 현재 public API로는 package가 반환하는 handle에 의존할 수 없으므로 concrete bus/server lifecycle 쪽에서 관리해야 합니다. 이 제약을 바꾸려면 public API 변경으로 다뤄야 합니다.
