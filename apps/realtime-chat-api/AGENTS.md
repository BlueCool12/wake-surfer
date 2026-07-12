# realtime-chat API Agent Context

이 앱은 realtime-chat HTTP API의 배포 가능한 런타임 쉘이다. 수정할 때 클래스 계층보다 함수 조립과
명시적 의존성 주입을 우선한다.

먼저 확인:

- `apps/realtime-chat-api/README.md`
- `apps/realtime-chat-api/owner-docs/runtime-operations.md`

외부에서 관찰 가능한 엔드포인트, 헤더, 상태 코드, 환경 설정을 바꾸면 같은 변경에서 다음 문서를
갱신한다.

- `apps/realtime-chat-api/public-docs/runtime-contract.md`

의존 provider의 내부 구현 문서는 기본 context로 사용하지 않는다.

| Dependency | Need | Read |
| --- | --- | --- |
| `packages/api-contracts` | 공통 오류 응답 계약 | `packages/api-contracts/README.md` |
| `packages/realtime-chat-database` | DB 조립 API | `packages/realtime-chat-database/README.md` |
| `packages/realtime-chat-gateway-ticket` | 티켓 유스케이스 조립 API | `packages/realtime-chat-gateway-ticket/README.md` |
| `packages/realtime-chat-gateway-ticket-contracts` | 외부 요청·응답 계약 | `packages/realtime-chat-gateway-ticket-contracts/README.md` |
