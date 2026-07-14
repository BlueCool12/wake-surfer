# Stream Messages 설계: Acceptance criteria와 비범위

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 19. 결정 후 구현 계획의 필수 acceptance criteria

### 19.1 공통

- 각 Query는 독립 input/output schema와 Handler를 가진다.
- actor는 신뢰 경계에서 주입되고 client-owned actor 필드는 거절된다.
- production public actor는 인증 session/trusted edge에서 주입하고 개발용 평문 actor header를 사용하지
  않는다.
- internal sync는 TLS와 Gateway service bearer credential을 먼저 검증한 뒤 local-session actor assertion을
  신뢰한다.
- 권한 거절 시 message content query를 실행하지 않는다.
- 모든 page는 같은 stream message만 sequence 오름차순으로 반환한다.
- Query는 message, stream head, read cursor를 수정하지 않는다.
- current server contract와 Web 임시 contract를 하나의 canonical message contract로 수렴시킨다.
- 첫 버전의 storage, mapper, runtime schema는 `USER/TEXT`만 일관되게 표현하고 `SYSTEM`을 허용하지 않는다.
- USER/TEXT write는 UTF-8 8KiB를 초과하면 `invalid_content`로 거절하고 DB에도 같은 invariant를 둔다.
- adapter/mount는 boundary별 canonical serializer로 만든 `measureFinalEnvelope` 크기 정책을 Query Handler에
  주입하고, Handler는 전송 형식을 모른 채 그 측정 결과로 48KiB page를 판정한다.
- DB failure와 API/Gateway transport failure를 domain rejection으로 위장하지 않는다.
- existing stream row와 resolved target의 일치를 append와 query 양쪽에서 검증한다.
- unsafe/음수/소수 cursor와 limit, 변조되거나 범위를 벗어난 watermark를 결정된 오류로 처리한다.

### 19.2 Latest

- 큰 stream에서 전체 history를 자동 조회하지 않는다.
- 현재 head 기준 최신 최대 5개, snapshot head, older continuation 의미가 정확하다.
- 읽을 수 있는 빈 channel은 stream row를 만들지 않고 빈 message page로 처리한다.
- 기존 sync cursor가 있으면 latest checkpoint로 중간 구간을 건너뛰지 않는다.
- latest page의 마지막 sequence가 snapshot head이고 current window 내부에 gap이 없는지 검증한다.
- query 중 live append와 겹쳐도 response/live merge로 message를 잃지 않는다.
- count 5보다 먼저 48KiB에 도달하면 head를 포함한 가장 가까운 연속 tail만 반환하고 `hasMoreBefore`를
  true로 둔다.

### 19.3 After sync

- publish 실패 또는 offline 뒤 저장 message를 복구한다.
- 첫 page의 snapshot watermark가 후속 page에서 고정된다.
- 여러 page와 concurrent append 상황에서도 유한하게 완료된다.
- 마지막 성공 cursor부터 안전하게 재개할 수 있다.
- final page의 cursor가 고정 watermark에 정확히 도달한다.
- gap과 invalid cursor를 결정된 오류 의미로 처리한다.
- page는 count 50/100과 최종 JSON 48KiB 상한을 모두 지킨다.
- 자동 recovery는 10 page, 500 message, 512KiB 중 먼저 도달한 시점에 `recovery_pending`으로 양보하고,
  같은 watermark와 마지막 연속 cursor에서 새 묶음을 자동 시작한다.
- 실패·부분 page와 cursor가 전진하지 않은 page는 적용량에 포함하지 않는다.
- Web은 raw HTTP response/WS frame byte 수를 누적하고 parsed object 재직렬화 값은 사용하지 않는다.

### 19.4 Older

- exclusive `beforeSequence`와 가장 가까운 과거 N개 의미를 지킨다.
- DB 선택 방향과 무관하게 response는 오름차순이다.
- concurrent append가 older page 경계를 흔들지 않는다.
- older load는 live sync cursor와 read cursor를 변경하지 않는다.
- count 50/100보다 먼저 48KiB에 도달하면 `beforeSequence`에 가장 가까운 연속 과거 구간만 반환한다.

### 19.5 Client merge

- latest response가 기존 live event를 배열 교체로 잃지 않는다.
- sync page와 live event가 겹쳐도 message가 한 번만 보인다.
- out-of-order live message는 buffer되고 gap sync 뒤 순서대로 적용된다.
- cursor 이하이면서 latest window 밖인 delayed event가 오래된 message를 현재 tail에 잘못 삽입하지 않는다.
- same sequence/different message 또는 same message/different sequence를 계약 위반으로 검출한다.
- channel stream에는 thread reply 본문이 섞이지 않는다.
- channel root message에는 `threadSummary`가 포함되지 않는다.

### 19.6 Scope와 recovery

- 공개 Query는 channel selector만 허용하고 DM/thread selector는 거절하거나 route 자체를 공개하지 않는다.
- 현재 channel 읽기 권한이 있으면 별도의 minimum readable sequence 없이 저장된 전체 history를 조회할 수
  있다.
- 첫 reply 전의 root message를 빈 thread로 조회할 수 없다.
- 같은 로그인 상태에서 reconnect와 browser reload 뒤에도 이전 sync cursor를 복원해 누락 구간을 먼저
  recovery한다.
- single message가 48KiB를 넘는 비정상 row는 skip/truncate하지 않고 cursor를 유지한 채 data-integrity
  failure로 기록한다.

## 20. 명시적 비범위

- message send와 idempotency 전체 재구현. 단, 공통 message contract 승격과 UTF-8 8KiB write invariant
  보강은 선행 범위에 포함한다.
- outbound broker와 Gateway fan-out 본체 구현
- `mark-read-cursor`와 unread projection
- channel list, DM list, inbox read model
- message search
- message edit/delete
- retention/hard delete
- DM과 thread의 stream messages 공개 Query
- `SYSTEM` message 조회
- 여러 stream을 한 요청으로 sync하는 batch protocol
- presence와 typing indicator
- thread summary projection의 최종 구현

## 21. Accepted 판정

다음 조건을 모두 만족했으므로 이 문서는 `Accepted`다.

1. `SM-01`~`SM-29`가 모두 `확정` 상태다.
2. 선택한 계약 이름과 cursor 의미가 문서 전체에서 하나로 통일됐다.
3. channel, DM, thread 중 첫 구현 범위와 `ChannelReadAuthorizer` consumer contract owner가 정해졌고,
   concrete provider 부재가 public adapter를 막는 선행 이슈로 명시됐다.
4. canonical public message contract의 owner가 정해졌다.
5. public HTTP/WebSocket adapter 범위가 정해졌다.
6. domain rejection과 retryable infrastructure failure가 구분됐다.
7. acceptance criteria가 최종 결정과 모순되지 않는다.

확정된 결정은 [이슈 단위 구현 계획](../implementation/README.md)에서
package/contract/API/Gateway/Web 작업과 테스트 단위로 분해했다. 구현이 완료되면 실제 소비자 계약은 각
provider `README.md`와 app `public-docs/`에 반영한다.
