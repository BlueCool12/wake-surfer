# Read Cursor 구현 계획: 출시 관문과 후속 capability

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 출시 관문

다음 조건을 모두 만족하기 전 production mark/read-state route를 활성화하지 않는다.

1. `DEP-AUTH-01`, `DEP-CH-01`: 사람 사용자 identity와 channel 기준 상태가 준비됐다.
2. `RCI-01`~`RCI-05`: 계약, table, 두 usecase, production adapter가 완료됐다.
3. allow-all authorizer, client actor ID, generic actor ID 직접 저장 경로가 production에 없다.
4. `RCI-06`~`RCI-08`: package-owned API/Gateway adapter와 service credential 경계가 동작한다.
5. `RCI-09`~`RCI-11`: active/visible/merge/gap/sender 규칙과 read-state 복구가 Web에서 동작한다.
6. `RCI-12`: HTTP/WS 분산 rate limit이 동작한다.
7. `RCI-13`: 생산자와 소비자가 같은 계약 fixture를 통과한다.
8. `RCI-14`: 실제 PostgreSQL과 process 경계의 경쟁·권한·복구 시나리오가 통과한다.
9. `RCI-15`: data-integrity failure와 retryable failure를 운영자가 구분할 수 있다.

## 후속 capability

다음은 현재 이슈에 합치지 않는다.

- DM/thread ReadCursor
- exact unread count와 inbox projection
- sender message 제외 projection
- same-user tab/device 즉시 push
- read receipt
- `ReadCursorAdvanced` outbox/event
- retention/delete와 cursor reset protocol
- bot/system/service principal

후속 기능이 현재 Accepted 의미를 바꾸면 먼저 설계 결정을 개정한다.
