# @wake-surfer/realtime-chat 사용법

API app은 이 패키지의 API adapter를 mounted feature module로 사용합니다.

```ts
await mountRealtimeChatApi(
  server,
  {
    basePath: '/api/realtime-chat',
    ticketTtlSeconds: 60
  },
  apiRuntimeDeps
);
```

Gateway app은 이 패키지의 gateway adapter를 mounted feature module로 사용합니다.

```ts
await mountRealtimeChatGateway(
  server,
  {
    path: '/ws/realtime-chat',
    gatewayId: env.GATEWAY_ID
  },
  gatewayRuntimeDeps
);
```

app은 process bootstrap, env parsing, server creation, concrete infra construction을 소유합니다. 이 패키지는 route suffix, socket protocol handling, request/event validation, command mapping, usecase, domain policy, session registry, outbound fan-out을 소유합니다.

internal path에서 command, handler, domain model, schema file, session registry class를 import하지 않습니다. app이 root/subpath에서 노출되지 않은 behavior를 필요로 한다면 public contract로 의도적으로 추가하고 `public-docs/api.md`를 갱신합니다.
