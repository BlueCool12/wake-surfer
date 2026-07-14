# Stream Messages 설계: 성능, snapshot, payload

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 17. 성능과 일관성

### 17.1 DB query

현재 `(stream_id, sequence)` index는 세 조회 shape에 충분하다. 구현 시 N+1 row를 읽어 `hasMore`를
판정하고 response에는 N개만 포함한다.

- latest: head 이하, sequence 내림차순 선택, response 오름차순
- after: cursor 초과와 watermark 이하, response 오름차순
- older: cursor 미만, sequence 내림차순 선택, response 오름차순

head와 message rows의 snapshot 의미는 하나의 SQL 또는 짧은 read-only transaction으로 검증한다. write
transaction이 `last_sequence` 증가와 message insert를 함께 commit하므로 미커밋 head만 노출되어서는 안
된다.

### 17.2 Payload와 종료 조건

모든 page에는 다음 상한을 적용한다.

- latest initial window: 최대 5개로 확정
- after/older default message count: 50개
- after/older maximum message count: 100개
- 최종 client-visible JSON envelope: UTF-8 직렬화 기준 최대 48KiB(49,152 byte)
- `USER/TEXT` write의 text: UTF-8 기준 최대 8KiB(8,192 byte)

count 상한보다 먼저 byte 상한에 도달하면 다음 message 직전에서 page를 끝내고 마지막으로 반환한 sequence를
continuation으로 사용한다. latest/older는 DB에서 가까운 message부터 선택한 뒤 byte 상한에 맞는 연속 구간만
오름차순으로 반환한다. after는 오름차순으로 byte 상한까지 반환한다. 어느 경우에도 message를 건너뛰거나
내용을 절단하지 않는다.

48KiB 판정은 message item 크기의 합이나 provider의 추정값으로 계산하지 않는다.
`@wake-surfer/realtime-chat-stream-messages-contracts`가 latest HTTP body, older HTTP body,
`chat.stream.synced` WebSocket event의 canonical JSON serializer와 UTF-8 byte 측정 함수를 소유한다.

Query Handler는 HTTP body나 WebSocket event 형식을 직접 알지 않는다. 각 adapter/mount가 실제
`requestId`, cursor, watermark와 candidate messages를 포함해 최종 client envelope을 직렬화하는
`measureFinalEnvelope(candidate)` 크기 정책을 만들고 Handler에 주입한다. Handler는 이 함수가 반환한 byte
수와 상한 충족 여부만 사용해 page와 continuation을 결정한다. adapter는 Handler가 판정한 동일 object를 같은
canonical serializer로 전송하고 마지막에 같은 상한을 assertion한다. sync-after internal HTTP mount도 내부
HTTP response 크기가 아니라 최종 `chat.stream.synced` event serializer를 사용하는 측정 정책을 주입한다.
따라서 세 Handler는 전송 중립성을 유지하면서도 실제 client-visible envelope의 48KiB 상한을 보장한다.

저장된 message 한 건만으로 48KiB를 넘으면 해당 row를 건너뛰거나 cursor를 전진시키지 않고
infrastructure/data-integrity failure로 중단한다. 외부에는 일반 retryable service/transport failure로
표현하고, 내부 관측에는 message ID, stream ID, sequence, byte 수만 남기며 content는 기록하지 않는다.
정상 write에서는 8KiB text 상한으로 이 상태를 예방한다. 현재 message-send 계약과 DB에는 이 상한이 없으므로
write validation과 DB invariant 보강이 stream messages 구현의 선행 작업이다.

한 번의 자동 after recovery 묶음은 다음 중 하나에 먼저 도달할 때 끝낸다.

- 성공적으로 적용한 page 10개
- 성공적으로 적용한 message 500개
- 최종 직렬화 response 누적 512KiB(524,288 byte)

`throughSequence`에 아직 도달하지 못했다면 오류가 아니라 `recovery_pending` 상태로 전환한다. 마지막으로
완전히 적용한 `nextAfterSequence`와 같은 `throughSequence`를 보존하고 event loop에 제어를 양보한 뒤 새
묶음을 자동 시작한다. 실패하거나 일부만 받은 page는 cursor와 누적량에 반영하지 않는다.
`hasMoreAfter = true`인데 cursor가 전진하지 않으면 무한 반복하지 않고 protocol failure로 중단한다.

server Query는 stateless page 단위이므로 48KiB 상한을 강제한다. 10 page/500 message/512KiB의 묶음 상한은
Web recovery orchestrator가 강제한다. 현재 page 상한에서는 10 page가 최대 480KiB이므로 512KiB는 먼저
도달하지 않는 방어적 이중 상한이다. 반복 호출 abuse 방지는 이 상한이 아니라 API/Gateway 공통 rate limit
책임이며, production public exposure 전 별도 보안 이슈로 완료한다.

Web transport는 HTTP raw response text 또는 WebSocket raw frame의 UTF-8 byte 수를 parse 전에 측정하고,
검증된 page와 함께 recovery orchestrator에 전달한다. orchestrator는 object를 다시 직렬화해 누적량을
추정하지 않는다.
