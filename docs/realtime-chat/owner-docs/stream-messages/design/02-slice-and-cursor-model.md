# Stream Messages 설계: Slice와 cursor 모델

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 5. Capability group과 slice 정의

`stream-messages`는 저장된 message timeline을 읽는 capability group이다. 실제 구현 slice는 하나의 Query
input, 하나의 Handler, 그 Query 전용 response envelope, slice-local query와 mapper로 구성한다.

TypeScript에 CQRS semantics를 적용하기 위해 별도 mediator framework를 도입할 필요는 없다. 현재 저장소의
함수 조립 스타일을 유지하면서 다음 경계를 지키면 된다.

- Query별 input/output envelope을 공유하지 않는다.
- 각 Handler는 자신의 시작과 끝을 소유한다.
- 세 Handler가 다른 Handler를 직접 호출하지 않는다.
- 공통 DB table을 읽을 수는 있지만 다른 slice의 query helper를 deep import하지 않는다.
- read slice는 message, stream, read cursor를 수정하지 않는다.
- HTTP와 WebSocket adapter는 Query input으로 mapping하고 결과를 외부 contract로 mapping한다.

공개 message item은 Query envelope과 성격이 다르다. 여러 외부 경계가 같은 저장 메시지를 표현해야 한다면
독립된 versioned message contract로 승격할 수 있다. 이것은 slice-local Query DTO 공유와 구분한다.

## 6. Cursor 용어와 상태 모델

최초 tail 조회와 누락 복구를 올바르게 분리하려면 cursor를 하나의 `lastSeenSequence`로 뭉뚱그리지 않아야
한다.

| 용어 | 의미 | 변경 주체 |
| --- | --- | --- |
| `headSequence` | 서버 stream에 저장 완료된 마지막 sequence | message append transaction |
| `throughSequence` | 한 번의 latest/sync 응답이 고정한 snapshot 상한 | Query Handler |
| `deliverySyncCursor` | client가 특정 기준점 이후 누락 없이 live 상태를 적용한 위치 | client merge model |
| `historyBeforeCursor` | 현재 로드한 history window의 가장 오래된 경계 | client history model |
| `ReadCursor` | 사용자가 실제로 읽었다고 서버에 표시한 위치 | `mark-read-cursor` command |

예를 들어 stream head가 1,000이고 최초 화면이 최신 5개인 996~1,000만 로드했다고 하자.

- client는 1~995를 로드하지 않았다.
- 그래도 latest snapshot을 적용한 뒤 live 복구 기준은 1,000으로 잡을 수 있다.
- 과거 더보기 기준은 996이다.
- 사용자가 실제로 읽은 위치는 별도의 `ReadCursor`다.

따라서 “1부터 연속으로 가진 모든 history”와 “latest snapshot 이후의 live 연속성”을 같은 cursor로 표현하면
안 된다. latest query는 과거 전체를 가져오는 sync가 아니라 live 상태를 시작할 checkpoint를 세우는
query다.

### 6.1 Query 선택 규칙

신뢰 가능한 `deliverySyncCursor`가 이미 있으면 화면 재진입이나 재접속에서 latest checkpoint를 새로
세우면 안 된다. cursor가 900인데 latest 996~1,000으로 바로 anchor하면 901~995를 영구적으로 건너뛸 수
있다.

확정된 선택 규칙은 다음과 같다.

- 신뢰 가능한 cursor가 있다: `sync-stream-messages-after-sequence`로 기존 cursor 이후를 먼저 복구한다.
- cursor가 없다: `load-latest-stream-messages`로 현재 head에 새 checkpoint를 세운다.
- 사용자가 명시적으로 “최신으로 이동”을 선택했다: 복구하지 않은 구간을 포기한다는 제품 의미를 확인한
  뒤 latest checkpoint를 재설정할 수 있다.
- 과거를 더 본다: `load-older-stream-messages`를 사용하며 live cursor와 독립적으로 처리한다.

같은 로그인 상태의 WebSocket reconnect와 browser reload 뒤에도 cursor를 복원해 누락 없는 recovery를
보장한다. 첫 구현은 `sessionStorage`에 actor와 channel별 `deliverySyncCursor`와 진행 중
`throughSequence`만 보존한다. 안정적인 인증 session namespace가 있을 때만 key에 추가하며, 연결마다
바뀌는 Gateway session ID는 key로 사용하지 않는다. message content는 저장하지 않는다. logout·계정 전환
때 해당 actor의 값을 폐기하고, 유효한 로그인 문맥과 일치하지 않는 값은 복원하지 않는다. memory-only
cursor는 이 보장 수준을 만족하지 못한다.
