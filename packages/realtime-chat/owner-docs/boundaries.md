# @wake-surfer/realtime-chat 경계

여기서 소유하는 것:

- chat HTTP route suffix와 handler flow
- chat WebSocket connect/message/push flow
- DTO-to-command mapping
- package-private command와 usecase
- message idempotency policy
- read cursor advance policy
- gateway ticket issue/consume integration boundary
- local gateway session registry
- outbound delivery publish 및 fan-out
- 이 feature에 필요한 port interface

여기서 소유하지 않는 것:

- process startup과 listen port
- env parsing
- concrete HTTP/WebSocket server implementation
- concrete DB, broker, permission, logger, metrics client
- frontend UI composition
- `@wake-surfer/realtime-chat-contracts`가 소유하는 public wire contract

Contracts 의존성:

- `@wake-surfer/realtime-chat-contracts` root export만 사용합니다.
- contracts owner docs 또는 notes를 coding context로 import하지 않습니다.
