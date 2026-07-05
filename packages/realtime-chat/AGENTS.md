# @wake-surfer/realtime-chat 에이전트 컨텍스트

이 패키지는 realtime chat feature 구현을 제공하는 provider입니다.

이 provider를 수정할 때는 먼저 다음 owner context를 읽습니다.

- `packages/realtime-chat/README.md`
- `packages/realtime-chat/owner-docs/architecture.md`
- `packages/realtime-chat/owner-docs/boundaries.md`
- `packages/realtime-chat/owner-docs/principles.md`
- `packages/realtime-chat/owner-docs/testing.md`

public export, mount semantics, runtime deps, route/socket semantics, consumer-facing invariant가 바뀌면 같은 변경에서 다음 public contract 문서를 함께 갱신합니다.

- `packages/realtime-chat/public-docs/api.md`
- `packages/realtime-chat/public-docs/usage.md`
- `packages/realtime-chat/public-docs/invariants.md`
- `packages/realtime-chat/public-docs/integration.md`

이 패키지는 dependency provider의 public contract만 consumer context로 사용합니다.

| 의존성 | 필요 | 읽을 파일 |
| --- | --- | --- |
| `packages/realtime-chat-contracts` | export된 DTO와 event 확인 | `packages/realtime-chat-contracts/public-docs/api.md` |
| `packages/realtime-chat-contracts` | 허용되는 contract 사용 방식 확인 | `packages/realtime-chat-contracts/public-docs/usage.md` |
| `packages/realtime-chat-contracts` | public wire invariant 확인 | `packages/realtime-chat-contracts/public-docs/invariants.md` |
| `packages/realtime-chat-contracts` | integration boundary 확인 | `packages/realtime-chat-contracts/public-docs/integration.md` |

consumer agent는 이 provider에 대해 `README.md`와 `public-docs/*`만 읽습니다. consumer route에 이 파일, `owner-docs/`, `notes/`를 포함하지 않습니다.

consumer에서 deny할 권장 경로:

- `packages/realtime-chat/AGENTS.md`
- `packages/realtime-chat/owner-docs`
- `packages/realtime-chat/notes`
