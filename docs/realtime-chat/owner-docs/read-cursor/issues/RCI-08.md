# RCI-08 Gateway WebSocket mark relay 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-06](./RCI-06.md)
- [SMI-21 Gateway connected readiness](../../stream-messages/issues/SMI-21.md)

### 관련 설계

- [입출력과 transport](../design/06-contracts-and-transport.md)
- [Identity와 권한](../design/04-identity-and-authorization.md)

## 작업 정의

**목표**

WebSocket mark event를 local authenticated session actor와 결합해 internal API로 전달하고 결과를 요청한
socket에만 반환한다.

**주요 변경**

- package-owned event registration과 strict parser
- connection ready 이전 command 차단
- local session actor assertion과 internal API client
- accepted/rejected/error mapper
- timeout, abort, socket close, correlation 처리
- Gateway shell mount 연결

**완료 조건**

- payload actor/user ID가 없고 있어도 strict schema가 거절한다.
- 다른 session이나 같은 사용자의 다른 socket에 결과를 fan-out하지 않는다.
- Gateway가 DB와 Read Cursor Handler에 직접 접근하지 않는다.
- 연결 종료 시 pending request가 취소되고 열린 handle이 남지 않는다.
- internal API의 retryable failure를 도메인 rejection으로 바꾸지 않는다.
- event registration과 cleanup test가 있다.

**비범위**

- read receipt broadcast
- same-user device push
- client debounce

권장 브랜치 slug: `read-cursor-gateway-relay`
