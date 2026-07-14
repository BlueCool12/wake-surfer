# Stream Messages 구현 계획: 출시 관문과 후속 capability

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 9. 출시 관문

다음 조건을 모두 만족하기 전 production public route를 활성화하지 않는다.

1. `DEP-CH-01`, `DEP-AUTH-01`: 실제 channel 기준 상태와 actor 인증 session/edge가 준비됐다.
2. `SMI-04`, `SMI-23`, `SMI-24`: application은 canonical stream target identity를 보장하고, application과
   DB는 UTF-8 8KiB content invariant를 함께 보장한다.
3. `SMI-05`: 실제 channel provider adapter가 연결되어 있고 allow-all fallback이 없다.
4. `SMI-20`~`SMI-22`: Gateway service 인증, connected readiness, Web authenticated session이 동작한다.
5. `SMI-10`~`SMI-12`: public/internal actor 신뢰 경계와 package-owned adapter가 분리돼 있다.
6. `SMI-25`: 분산 rate limit이 HTTP/WS 양쪽에서 동작한다.
7. `SMI-17`: 생산자와 모든 소비자가 같은 계약 fixture를 통과한다.
8. `SMI-18`: 실제 process/DB recovery 시나리오가 통과한다.
9. `SMI-19`: data-integrity failure와 retryable failure를 운영자가 구분할 수 있다.

## 10. 별도 capability로 유지할 후속 작업

아래 작업은 현재 저장소에 없지만 Stream Messages 이슈에 합치지 않는다.

- message-send HTTP/WS adapter 조립
- Redis outbound broker와 Gateway local fan-out
- `chat.message.created` 실제 push
- `mark-read-cursor`와 unread projection
- channel list, inbox, DM list read model
- DM/thread Stream Messages 공개 Query
- retention과 cursor reset protocol
- service-to-service mTLS 또는 signed assertion 전환

Stream Messages만 완료해도 저장 message의 최초 조회, 과거 조회, 명시적 누락 복구는 동작한다. 그러나 실제
새 message 실시간 push와 message 전송까지 포함한 전체 chat runtime을 출시하려면 message-send와
outbound-delivery의 별도 이슈 묶음이 추가로 필요하다.
