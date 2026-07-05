# @wake-surfer/realtime-chat 공개 API

consumer는 package root 또는 public subpath에서만 import합니다. `src/**`, `dist/**` deep import는 public contract가 아닙니다.

## Import surface

Root import:

```ts
import {
  mountRealtimeChatApi,
  mountRealtimeChatGateway,
  type RealtimeChatApiMountOptions,
  type RealtimeChatApiRuntimeDeps,
  type RealtimeChatGatewayMountOptions,
  type RealtimeChatGatewayRuntimeDeps,
} from "@wake-surfer/realtime-chat";
```

API adapter 전용 import:

```ts
import {
  mountRealtimeChatApi,
  type HttpServerLike,
  type HttpRequestLike,
  type HttpResponseLike,
  type HttpRouteDefinition,
  type RealtimeChatApiMountOptions,
  type RealtimeChatApiRuntimeDeps,
} from "@wake-surfer/realtime-chat/api";
```

Gateway adapter 전용 import:

```ts
import {
  mountRealtimeChatGateway,
  type WebSocketConnectionLike,
  type WebSocketRouteDefinition,
  type WebSocketServerLike,
  type RealtimeChatGatewayMountOptions,
  type RealtimeChatGatewayRuntimeDeps,
} from "@wake-surfer/realtime-chat/gateway";
```

## Root exports

| export                                                                                                  | 목적                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `mountRealtimeChatApi`                                                                                  | app-owned HTTP server에 realtime chat API route 전체 등록     |
| `mountRealtimeChatGateway`                                                                              | app-owned WebSocket server에 realtime chat gateway route 등록 |
| `RealtimeChatApiMountOptions`                                                                           | API adapter mount 설정                                        |
| `RealtimeChatGatewayMountOptions`                                                                       | Gateway adapter mount 설정                                    |
| `RealtimeChatApiRuntimeDeps`                                                                            | API side app-supplied runtime dependency contract             |
| `RealtimeChatGatewayRuntimeDeps`                                                                        | Gateway side app-supplied runtime dependency contract         |
| `HttpServerLike`, `HttpRequestLike`, `HttpResponseLike`, `HttpRouteDefinition`, `HttpRouteHandler`      | API adapter용 최소 HTTP server contract                       |
| `WebSocketServerLike`, `WebSocketConnectionLike`, `WebSocketRouteDefinition`, `WebSocketMessagePayload` | Gateway adapter용 최소 WebSocket server contract              |

`@wake-surfer/realtime-chat/api`는 API side port type도 export합니다.

| export                                                                                                     | 목적                                                                       |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `RealtimeChatDbPort`                                                                                       | API side persistence port                                                  |
| `PermissionPort`, `PermissionDecision`, `RealtimeChatMessageTarget`                                        | API side permission/recipient resolution port                              |
| `OutboundEventBusPort`                                                                                     | API side outbound delivery publish port                                    |
| `ClockPort`, `IdGeneratorPort`, `LoggerPort`, `MetricsPort`, `TicketHasherPort`                            | API side common infrastructure port                                        |
| `StoredRealtimeChatMessage`, `StoredGatewayTicket`, `StoredGatewayTicketConsumeResult`, `StoredReadCursor` | app-owned persistence adapter가 반환하거나 저장하는 public port data shape |

`@wake-surfer/realtime-chat/gateway`는 Gateway side port type도 export합니다.

| export                                                                            | 목적                                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------- |
| `RealtimeChatApiClientPort`                                                       | Gateway가 API app과 통신할 때 사용하는 client port |
| `GatewayTicketConsumePort`, `GatewayTicketConsumeResult`, `ConsumedGatewayTicket` | gateway ticket consume port                        |
| `OutboundEventBusPort`, `OutboundEventSubscription`                               | Gateway side outbound delivery subscribe port      |
| `ClockPort`, `IdGeneratorPort`, `LoggerPort`, `MetricsPort`                       | Gateway side common infrastructure port            |

## API mount contract

```ts
type RealtimeChatApiMountOptions = {
  basePath: string;
  exposeOpenApi?: boolean;
  gatewayUrl?: string;
  gatewayTicketTtlSeconds?: number;
  maxMessageTextLength?: number;
  syncDefaultLimit?: number;
  syncMaxLimit?: number;
};

function mountRealtimeChatApi(
  server: HttpServerLike,
  options: RealtimeChatApiMountOptions,
  deps: RealtimeChatApiRuntimeDeps,
): Promise<void>;
```

`basePath`는 trim 후 leading slash를 보정하고 trailing slash를 제거합니다. `''` 또는 `'/'`는 root path로 취급합니다.

| option                    | 기본값  | 의미                                                                     |
| ------------------------- | ------- | ------------------------------------------------------------------------ |
| `basePath`                | 없음    | 등록할 HTTP route prefix                                                 |
| `gatewayUrl`              | 없음    | gateway ticket response에 포함할 advertised gateway URL                  |
| `gatewayTicketTtlSeconds` | `60`    | gateway ticket 만료 시간                                                 |
| `maxMessageTextLength`    | `4000`  | text message 최대 길이                                                   |
| `syncDefaultLimit`        | `50`    | stream sync 요청에 `limit`이 없을 때 사용하는 개수                       |
| `syncMaxLimit`            | `100`   | stream sync 요청 limit 상한                                              |
| `exposeOpenApi`           | `false` | 현재 public option으로 존재하지만 별도 OpenAPI route를 등록하지 않습니다 |

## HTTP server adapter contract

app은 사용하는 HTTP framework를 다음 contract로 감싸서 넘깁니다.

```ts
type HttpMethod = "GET" | "POST";

type HttpRequestLike = {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body?: unknown;
};

type HttpResponseLike = {
  status: number;
  body?: unknown;
};

type HttpRouteHandler = (request: HttpRequestLike) => HttpResponseLike | Promise<HttpResponseLike>;

type HttpRouteDefinition = {
  method: HttpMethod;
  path: string;
  handler: HttpRouteHandler;
};

type HttpServerLike = {
  route: (definition: HttpRouteDefinition) => void | Promise<void>;
};
```

HTTP adapter는 path params를 `request.params`에, query string을 `request.query`에, headers를 lowercase key 기준으로 `request.headers`에 넣어야 합니다.

## API runtime deps

```ts
type RealtimeChatApiRuntimeDeps = {
  db: RealtimeChatDbPort;
  permissionPort: PermissionPort;
  outboundEventBus: { publish(event: OutboundMessageDeliveryRequested): Promise<void> };
  clock: { now(): Date };
  idGenerator: { generateId(scope: string): string };
  logger: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
  metrics?: { increment(name: string, tags?: Record<string, string>): void };
  ticketHasher?: { hash(ticketValue: string): string | Promise<string> };
};
```

API side `PermissionPort`:

```ts
type PermissionPort = {
  canIssueGatewayTicket?: (input: {
    actorId: UserId;
    workspaceId?: WorkspaceId;
  }) => Promise<PermissionDecision>;
  canWriteMessage: (input: {
    actorId: UserId;
    target: RealtimeChatMessageTarget;
  }) => Promise<PermissionDecision>;
  canReadStream: (input: { actorId: UserId; streamId: StreamId }) => Promise<PermissionDecision>;
  resolveMessageRecipients: (input: {
    actorId?: UserId;
    target: RealtimeChatMessageTarget;
    streamId: StreamId;
  }) => Promise<UserId[]>;
};
```

API side `RealtimeChatDbPort`:

```ts
type RealtimeChatDbPort = {
  issueGatewayTicket(ticket: StoredGatewayTicket): Promise<void>;
  consumeGatewayTicket(input: {
    ticketValueHash: string;
    consumedAt: ISODateTime;
  }): Promise<StoredGatewayTicketConsumeResult>;
  findMessageByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredRealtimeChatMessage | undefined>;
  appendMessage(input: {
    messageId: MessageId;
    target: RealtimeChatMessageTarget;
    streamType: StreamType;
    senderId?: UserId;
    messageType: MessageType;
    content: MessageContentDto;
    idempotencyKey?: string;
    createdAt: ISODateTime;
  }): Promise<StoredRealtimeChatMessage>;
  markReadCursor(input: {
    actorId: UserId;
    streamId: StreamId;
    lastReadSequence: number;
    updatedAt: ISODateTime;
  }): Promise<StoredReadCursor>;
  listMessages(input: {
    streamId: StreamId;
    afterSequence?: number;
    beforeSequence?: number;
    limit: number;
  }): Promise<{
    messages: StoredRealtimeChatMessage[];
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  }>;
};
```

`RealtimeChatMessageTarget`는 `{ kind: 'channel'; workspaceId; channelId }`, `{ kind: 'dm'; dmConversationId }`, `{ kind: 'thread'; threadId }` 중 하나입니다.

## API route semantics

| method | `basePath` 아래 suffix                      | input 위치                                                               | 성공 응답                          | 실패 응답                                        |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------ |
| `POST` | `/gateway-tickets`                          | body `IssueGatewayTicketRequest`, 또는 header `x-actor-id` fallback      | `201 IssueGatewayTicketResponse`   | `400 INVALID_PAYLOAD`, `403 <permission reason>` |
| `POST` | `/internal/gateway-tickets/consume`         | body `ConsumeGatewayTicketRequest`                                       | `200 ConsumeGatewayTicketResponse` | `400 INVALID_PAYLOAD`                            |
| `POST` | `/internal/messages/channel`                | body `SendChannelMessageRequest`                                         | `200 MessageCommandResponse`       | `400 INVALID_PAYLOAD`                            |
| `POST` | `/internal/messages/dm`                     | body `SendDMMessageRequest`                                              | `200 MessageCommandResponse`       | `400 INVALID_PAYLOAD`                            |
| `POST` | `/internal/messages/thread-replies`         | body `ReplyThreadMessageRequest`                                         | `200 MessageCommandResponse`       | `400 INVALID_PAYLOAD`                            |
| `POST` | `/internal/read-cursors`                    | body `MarkReadCursorRequest`                                             | `200 MarkReadCursorResponse`       | `400 INVALID_PAYLOAD`, `403 <permission reason>` |
| `GET`  | `/streams/:streamId/messages`               | params `streamId`, query `requestId`, `actorId`, optional sequence/limit | `200 SyncStreamMessagesResponse`   | `400 INVALID_PAYLOAD`, `403 <permission reason>` |
| `POST` | `/internal/system-messages/session-started` | body `PostSessionStartedSystemMessageRequest`                            | `200 MessageCommandResponse`       | `400 INVALID_PAYLOAD`                            |

Error response shape:

```ts
type ErrorResponse = {
  reason: RealtimeChatErrorCode;
  message?: string;
};
```

Validation은 필요한 필드만 읽고 알 수 없는 extra field는 현재 거부하지 않습니다. string field는 trim 후 빈 문자열이면 없는 값으로 처리합니다.

Gateway ticket semantics:

- `IssueGatewayTicketRequest`는 `actorId`와 optional `workspaceId`만 받습니다.
- `actorId`는 body에 없으면 `x-actor-id` header에서 fallback으로 읽습니다.
- `gatewayTicketTtlSeconds`는 request DTO가 아니라 `RealtimeChatApiMountOptions`로 주입합니다.
- response의 `gatewayUrl`은 `RealtimeChatApiMountOptions.gatewayUrl`이 설정된 경우에만 포함합니다.
- ticket 저장 시 `db.issueGatewayTicket`에는 raw ticket이 아니라 `ticketValueHash`가 전달됩니다.
- ticket consume 시 API adapter가 raw ticket을 hash하고 `db.consumeGatewayTicket`에 `ticketValueHash`와 `consumedAt`을 전달합니다.
- gateway app은 ticket table을 직접 보지 않고 `GatewayTicketConsumePort` 구현에서 API consume endpoint를 호출합니다.

Message semantics:

- text content는 `{ kind: 'text', text: string }`만 받습니다.
- 빈 text 또는 `maxMessageTextLength` 초과 text는 `MESSAGE_CONTENT_INVALID` rejected response가 됩니다.
- user message idempotency는 sender, target, `clientMessageId` 조합입니다.
- 저장 성공 후 outbound delivery publish는 best effort입니다. publish 실패는 accepted message를 rollback하지 않습니다.
- process 간 push fan-out은 app-owned broker adapter가 `OutboundMessageDeliveryRequested`를 publish/subscribe해서 연결합니다.

Sync semantics:

- `afterSequence`, `beforeSequence`, `limit` query는 non-negative integer string만 인정합니다.
- 내부 sync limit은 `Math.min(Math.max(requestedLimit, 1), syncMaxLimit)`로 계산합니다.
- `requestedLimit`은 query `limit`, `syncDefaultLimit`, `50` 순서로 결정합니다.

## Gateway mount contract

```ts
type RealtimeChatGatewayMountOptions = {
  path: string;
  gatewayId: string;
  maxPayloadBytes?: number;
};

function mountRealtimeChatGateway(
  server: WebSocketServerLike,
  options: RealtimeChatGatewayMountOptions,
  deps: RealtimeChatGatewayRuntimeDeps,
): Promise<void>;
```

| option            | 기본값  | 의미                                          |
| ----------------- | ------- | --------------------------------------------- |
| `path`            | 없음    | 등록할 WebSocket route path                   |
| `gatewayId`       | 없음    | `gateway.connected` event에 포함할 gateway id |
| `maxPayloadBytes` | `65536` | client socket payload byte limit              |

현재 public mount는 `Promise<void>`만 반환하며 dispose handle을 반환하지 않습니다. Gateway mount는 `deps.outboundEventBus.subscribe(...)`를 호출해 outbound delivery subscriber를 시작합니다.

## WebSocket server adapter contract

```ts
type WebSocketMessagePayload = string | Uint8Array | ArrayBuffer;

type WebSocketConnectionLike = {
  id?: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  send: (payload: string) => void | Promise<void>;
  close: (code?: number, reason?: string) => void | Promise<void>;
  onMessage: (handler: (payload: WebSocketMessagePayload) => void | Promise<void>) => void;
  onClose: (handler: () => void | Promise<void>) => void;
};

type WebSocketRouteDefinition = {
  path: string;
  onConnection: (connection: WebSocketConnectionLike) => void | Promise<void>;
};

type WebSocketServerLike = {
  route: (definition: WebSocketRouteDefinition) => void | Promise<void>;
};
```

Gateway adapter는 server event를 `JSON.stringify(event)`한 string payload로 `connection.send`에 전달합니다.

## Gateway runtime deps

```ts
type RealtimeChatGatewayRuntimeDeps = {
  chatApiClient: RealtimeChatApiClientPort;
  gatewayTicketPort: GatewayTicketConsumePort;
  outboundEventBus: {
    subscribe(
      handler: (event: OutboundMessageDeliveryRequested) => void | Promise<void>,
    ): OutboundEventSubscription | Promise<OutboundEventSubscription>;
  };
  clock: { now(): Date };
  idGenerator: { generateId(scope: string): string };
  logger: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
  metrics?: { increment(name: string, tags?: Record<string, string>): void };
};
```

Gateway `RealtimeChatApiClientPort`:

```ts
type RealtimeChatApiClientPort = {
  issueGatewayTicket?: (input: {
    actorId: UserId;
    workspaceId?: WorkspaceId;
  }) => Promise<IssueGatewayTicketResponse>;
  sendChannelMessage(request: SendChannelMessageRequest): Promise<MessageCommandResponse>;
  sendDMMessage(request: SendDMMessageRequest): Promise<MessageCommandResponse>;
  replyThreadMessage(request: ReplyThreadMessageRequest): Promise<MessageCommandResponse>;
  markReadCursor(request: MarkReadCursorRequest): Promise<MarkReadCursorResponse>;
  syncStreamMessages(request: SyncStreamMessagesRequest): Promise<SyncStreamMessagesResponse>;
};
```

Gateway ticket port:

```ts
type GatewayTicketConsumeResult =
  | {
      status: "consumed";
      ticket: { actorId: UserId; workspaceId?: WorkspaceId; consumedAt?: string };
    }
  | { status: "rejected"; reason: RealtimeChatErrorCode; message?: string };

type GatewayTicketConsumePort = {
  consume(ticketValue: string): Promise<GatewayTicketConsumeResult>;
};
```

## Gateway socket semantics

- ticket은 query `ticket`에서 먼저 읽고, 없으면 header `x-gateway-ticket`에서 읽습니다.
- ticket이 없으면 `gateway.connection.rejected`를 보낸 뒤 `close(4401, 'GATEWAY_TICKET_MISSING')`를 호출합니다.
- ticket consume이 rejected이면 rejected reason으로 `gateway.connection.rejected`를 보낸 뒤 `close(4401, reason)`을 호출합니다.
- connection 성공 시 `gateway.connected`를 보냅니다.
- `sessionId`는 `idGenerator.generateId('gateway-session')`로 생성합니다.
- client payload는 string, `Uint8Array`, `ArrayBuffer`를 받을 수 있고 JSON object로 parse되어야 합니다.
- payload byte length가 `maxPayloadBytes`를 넘으면 `gateway.error` reason은 `PAYLOAD_TOO_LARGE`입니다.
- malformed JSON 또는 필수 필드 누락은 `gateway.error` reason `INVALID_PAYLOAD`입니다.
- 지원하지 않는 event `type`은 `gateway.error` reason `UNSUPPORTED_EVENT_TYPE`입니다.
- accepted/rejected API response는 socket event로 relay합니다.
- API client 호출 실패는 `gateway.error` reason `API_UNAVAILABLE`, `retryable: true`로 relay합니다.
- outbound delivery event는 `recipientUserIds`에 해당하는 local session에만 `chat.message.created` payload를 push합니다.
