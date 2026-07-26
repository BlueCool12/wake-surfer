# Realtime Chat API Agent Context

이 app은 Stream Messages provider의 consumer다. provider 내부 구현 문서를 기본 context로 사용하지 않는다.

| Dependency | Need | Read |
| --- | --- | --- |
| `realtime-chat-stream-messages` | 공개 유스케이스와 불변조건 | `packages/realtime-chat-stream-messages/README.md` |
| `realtime-chat-stream-messages-contracts` | HTTP request/response와 직렬화 계약 | `packages/realtime-chat-stream-messages-contracts/README.md` |

Stream Messages HTTP route, actor 인증 연결, final-envelope budget, 오류 mapping과 rate limit은
`src/features/stream-messages`에서 app이 소유한다. provider의 `owner-docs`, `AGENTS.md` 또는 `src/`를
consumer context나 deep import 대상으로 사용하지 않는다.

## App owner context

이 app 자체를 수정할 때 먼저 확인:

- `apps/realtime-chat-api/README.md`
- `apps/realtime-chat-api/owner-docs/runtime-operations.md`

외부 endpoint, 설정, 상태 확인 또는 종료 의미를 바꾸면 같은 변경에서
`apps/realtime-chat-api/public-docs/runtime-contract.md`를 갱신한다.

`apps/realtime-chat-api/notes`는 사람용 배경 문서이며 agent context route에 포함하지 않는다.
