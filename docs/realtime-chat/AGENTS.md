# realtime-chat 문서 Agent Context

문서 작업은 역할에 따라 필요한 context만 읽는다.

| 작업 | Read |
| --- | --- |
| 전체 구조 | `docs/realtime-chat/README.md`, `docs/realtime-chat/public-docs/architecture.md` |
| Stream Messages consumer | `docs/realtime-chat/public-docs/stream-messages/api.md`, `invariants.md`, `recovery.md` |
| Stream Messages owner | `docs/realtime-chat/owner-docs/stream-messages/decisions.md`, `implementation-map.md` |
| Read Cursor 설계 owner | `docs/realtime-chat/owner-docs/read-cursor/decisions.md`, `design/README.md` |
| Read Cursor 이슈 owner | `docs/realtime-chat/owner-docs/read-cursor/implementation-map.md`, `implementation/README.md` |

`notes/`는 사람용 background archive이며 agent route에 포함하지 않는다. consumer는 owner-docs를 기본적으로 읽지 않는다. Read Cursor 도메인 결정은 승인됐지만 공개 계약은 아직 없으므로, consumer route는 public contract가 생긴 뒤 추가한다.
