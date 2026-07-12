# realtime-chat 문서 안내

이 디렉터리는 `realtime-chat` 기능군을 가로지르는 문서를 분류한다. 탐색 기록과 현재 구현 계약을
같은 우선순위로 읽지 않는다.

## 현재 구현 기준

- 내부 구현 결정: `docs/realtime-chat/owner-docs/implemented-decisions.md`
- 게이트웨이 티켓 공개 표면: `packages/realtime-chat-gateway-ticket/README.md`
- 게이트웨이 티켓 외부 계약: `packages/realtime-chat-gateway-ticket-contracts/README.md`
- 메시지 전송 공개 표면: `packages/realtime-chat-message-send/README.md`
- 메시지 전송 외부 계약: `packages/realtime-chat-message-send-contracts/README.md`
- 공유 데이터베이스 런타임: `packages/realtime-chat-database/README.md`

각 기능의 소비자는 필요한 기능 패키지의 공개 문서만 읽는다. 기능 내부 변경이 필요할 때만 해당
기능의 소유자 문맥으로 전환한다.

## 검토 중인 상위 문서

- `docs/realtime-chat/realtime-chat-architecture.md`

이 아키텍처 문서는 별도 검토가 끝나기 전까지 상위 방향을 설명하는 자료로만 사용한다. 개별 기능의
현재 계약과 충돌하면 기능 패키지의 코드, 테스트, README와 `owner-docs/implemented-decisions.md`를
우선한다.

## 사람용 설계 이력

`docs/realtime-chat/notes/`에는 최초 스케치, 흐름 제안, 이벤트 스토밍 기록을 둔다. 이 자료는 결정의
배경을 이해할 때만 사람이 참고하며 현재 구현 계약이 아니다.

- `docs/realtime-chat/notes/gateway-relay-sequence.md`
- `docs/realtime-chat/notes/flow-sequence-guide.md`
- `docs/realtime-chat/notes/event-storming.md`

`notes/`는 `AGENTS.md`의 기본 또는 선택 문맥에 포함하지 않는다. 에이전트가 따라야 하는 내용은 먼저
`owner-docs/` 또는 기능 패키지의 공개 문서로 승격한다.
