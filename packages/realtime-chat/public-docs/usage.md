# @wake-surfer/realtime-chat 사용법

API app과 Gateway app은 이 패키지를 mounted feature module로 사용합니다. app은 process bootstrap, env parsing, concrete server, concrete DB/broker/logger/metrics/auth adapter를 만들고, 이 패키지는 chat route/socket behavior를 소유합니다.

## API app

```ts
import {
  mountRealtimeChatApi,
  type HttpServerLike,
  type RealtimeChatApiRuntimeDeps
} from '@wake-surfer/realtime-chat/api';

const server: HttpServerLike = {
  route(definition) {
    httpFramework.register({
      method: definition.method,
      path: definition.path,
      handler: async (request) => {
        const response = await definition.handler({
          params: request.params,
          query: request.query,
          headers: request.headers,
          body: request.body
        });

        return httpFramework.response(response.status, response.body);
      }
    });
  }
};

const deps: RealtimeChatApiRuntimeDeps = {
  db,
  permissionPort,
  outboundEventBus,
  clock,
  idGenerator,
  logger,
  metrics,
  ticketHasher
};

await mountRealtimeChatApi(
  server,
  {
    basePath: '/api/realtime-chat',
    gatewayUrl: 'wss://example.test/ws/realtime-chat',
    gatewayTicketTtlSeconds: 60,
    maxMessageTextLength: 4000,
    syncDefaultLimit: 50,
    syncMaxLimit: 100
  },
  deps
);
```

## Gateway app

```ts
import {
  mountRealtimeChatGateway,
  type RealtimeChatGatewayRuntimeDeps,
  type WebSocketServerLike
} from '@wake-surfer/realtime-chat/gateway';

const server: WebSocketServerLike = {
  route(definition) {
    wsFramework.route(definition.path, async (socket) => {
      await definition.onConnection({
        id: socket.id,
        query: socket.query,
        headers: socket.headers,
        send: (payload) => socket.send(payload),
        close: (code, reason) => socket.close(code, reason),
        onMessage: (handler) => socket.on('message', handler),
        onClose: (handler) => socket.on('close', handler)
      });
    });
  }
};

const deps: RealtimeChatGatewayRuntimeDeps = {
  chatApiClient,
  gatewayTicketPort,
  outboundEventBus,
  clock,
  idGenerator,
  logger,
  metrics
};

await mountRealtimeChatGateway(
  server,
  {
    path: '/ws/realtime-chat',
    gatewayId: env.GATEWAY_ID,
    maxPayloadBytes: 64 * 1024
  },
  deps
);
```

## Import rule

internal path에서 command, handler, domain model, schema file, session registry class를 import하지 않습니다. app이 root/subpath에서 노출되지 않은 behavior를 필요로 한다면 public contract로 의도적으로 추가하고 `public-docs/api.md`를 갱신합니다.

## Adapter rule

- HTTP adapter는 framework-specific request/response를 `HttpRequestLike`와 `HttpResponseLike`로 변환합니다.
- WebSocket adapter는 framework-specific socket을 `WebSocketConnectionLike`로 변환합니다.
- app은 package-private command/usecase/router/session registry를 만들지 않습니다.
- app은 route suffix와 socket event switch를 직접 구현하지 않습니다.
