# realtime-chat gateway Agent Context

이 앱은 WebSocket 연결 생명주기를 소유하는 배포 가능한 런타임 쉘이다. 수정할 때 클래스 계층보다
함수 조립, 명시적 상태 객체, 작은 생명주기 함수를 우선한다.

먼저 확인:

- `apps/realtime-chat-gateway/README.md`
- `apps/realtime-chat-gateway/owner-docs/runtime-operations.md`

외부에서 관찰 가능한 endpoint, close code, 연결 제한, 환경 설정을 바꾸면 같은 변경에서 다음 문서를
갱신한다.

- `apps/realtime-chat-gateway/public-docs/runtime-contract.md`

의존 provider의 내부 구현 문서는 기본 context로 사용하지 않는다.

| Dependency | Need | Read |
| --- | --- | --- |
| `packages/realtime-chat-gateway-ticket-contracts` | ticket 소비 요청·응답 계약 | `packages/realtime-chat-gateway-ticket-contracts/README.md` |
