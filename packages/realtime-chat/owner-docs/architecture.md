# @wake-surfer/realtime-chat 구조

이 패키지는 realtime chat feature 구현 전체를 하나의 package로 소유합니다. API와 Gateway는 서로 다른 app/process에 mount될 수 있지만, 같은 chat feature의 adapter이므로 하나의 구현 패키지 안에서 경계를 나눕니다.

현재 source layout:

| 경로                          | 책임                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `src/index.ts`                | root public API export                                          |
| `src/api/public.ts`           | API adapter public API                                          |
| `src/api/http/*`              | API route registration, handler, request validation             |
| `src/api/application/*`       | API side usecase orchestration                                  |
| `src/api/domain/*`            | message, ticket, idempotency policy                             |
| `src/api/runtime-deps.ts`     | API side app-supplied port 및 runtime dependency type           |
| `src/gateway/public.ts`       | Gateway adapter public API                                      |
| `src/gateway/websocket/*`     | WebSocket mount, connection/message handling, socket validation |
| `src/gateway/application/*`   | Gateway side usecase orchestration                              |
| `src/gateway/session/*`       | local session model 및 registry                                 |
| `src/gateway/runtime-deps.ts` | Gateway side app-supplied port 및 runtime dependency type       |

app은 composition root입니다. command name, route handler 내부, socket event router 내부, session registry shape를 알면 안 됩니다.
