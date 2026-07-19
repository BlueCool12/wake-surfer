# Stream Messages Agent Context

이 provider를 수정할 때는 다음 owner context를 먼저 확인한다.

- `packages/realtime-chat-stream-messages/README.md`
- `packages/realtime-chat-stream-messages/owner-docs/architecture.md`

공개 API, Query 의미 또는 consumer-facing invariant를 바꾸면 같은 변경에서 README를 갱신한다.

`src/usecases`는 package 내부 구현이며 consumer에게 직접 노출하지 않는다.
