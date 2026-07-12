# realtime-chat 문서 Agent Context

`docs/realtime-chat` 문서를 수정할 때 현재 구현 문맥은 다음 파일에서 시작한다.

- `docs/realtime-chat/README.md`
- `docs/realtime-chat/owner-docs/implemented-decisions.md`

기능별 공개 계약은 `docs/realtime-chat/README.md`에 적힌 각 패키지 README에서 확인한다. 중앙 문서가
기능 패키지의 코드, 테스트, 공개 계약과 충돌하면 기능 패키지를 우선한다.

## notes 경계

`docs/realtime-chat/notes/`는 사람용 설계 이력이며 현재 구현 계약이 아니다.

- 기본 또는 선택 구현 문맥으로 읽지 않는다.
- 초기 스케치의 후보 모델과 이벤트 이름을 현재 규칙으로 승격하지 않는다.
- 사용자가 특정 설계 이력의 검토나 정리를 명시적으로 요청했을 때만 대상 파일을 읽는다.
- 현재 구현에 필요한 내용은 코드와 테스트로 확인한 뒤 `owner-docs/` 또는 기능 패키지의 공개 문서로
  먼저 승격한다.

`docs/realtime-chat/realtime-chat-architecture.md`는 검토가 끝나기 전까지 방향 문서로만 취급한다.
