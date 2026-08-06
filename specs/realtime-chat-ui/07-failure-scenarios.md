# 07. 실패 시나리오

## 목적

실패를 “서버 오류” 하나로 접지 않고 다음 네 관점을 분리한다.

| 기호 | 관점 | 질문 |
| --- | --- | --- |
| `C` | Client | 사용자가 보는 local/optimistic/cursor 상태는 무엇인가? |
| `G` | Gateway | frame, connection, local session/subscription을 알고 있는가? |
| `A` | API/기준 저장소 | 명령이 도달했고 기준 상태가 commit됐는가? |
| `O` | Other Client | 다른 구독자는 어떤 event를 관찰했는가? |

복구 표기의 의미는 다음과 같다.

- `재전송`: 같은 논리 명령을 같은 멱등 키로 다시 보낸다.
- `catch-up`: 새 Gateway session에서 저장된 stream sequence 이후를 조회한다.
- `full sync`: local delivery cursor를 폐기하고 권한이 허용하는 현재 snapshot에서 다시 시작한다.
- `session resume 없음`: 현재 Gateway session 자체는 복원하지 않고 새 ticket/connection을 만든다.

## 메시지 전송 실패 주입 지점

```text
Client
  A. frame 전송 전
Gateway
  B. frame 수신 후
API
  C. 명령 수신 후
Storage
  D. commit 후
Delivery Publication
  E. delivery 요청 기록/발행 후
Fan-out
  F. 일부 connection 전달 후
Sender ACK
  G. sender 결과 반환 전후
```

현재 runtime에는 durable delivery publication이 연결되지 않았다. 따라서 E 지점은 목표 경계 분석에는
남기되, 현행 경로는 API accepted response를 받은 Gateway가 바로 로컬 fan-out하는 D→F 흐름이다.

## 연결과 인증

| ID | 실패·주입 지점 | C / G / A / O 상태 | 위험 | 재시도·복구·사용자 표시 | 현행 |
| --- | --- | --- | --- | --- | --- |
| FS-CON-001 | TCP/TLS/upgrade 연결 자체 실패 | C: `CONNECTING`, session 없음; G: session 없음; A/O: 변화 없음 | 데이터 없음 | Client가 bounded backoff 후 새 ticket으로 재접속. 성공 후 catch-up. “연결 중/오프라인” 표시 | 재연결 client 있음 |
| FS-CON-002 | 인증 token 또는 Gateway ticket 무효 | C: `AUTHENTICATING`; G: ticket actor 없음; A: 발급 401 또는 consume rejected; O: 없음 | 비인가 연결 | 같은 ticket 반복 금지. Auth 복구 후 새 ticket. 자동 무한 재시도 안 함. “다시 로그인 필요” | ticket rejected는 close 4401. 현행 public actor 경계는 verified token이 아니라 개발용 trusted header |
| FS-CON-003 | token이 연결 도중 만료 | C: 현행은 READY로 계속 보일 수 있음; G: local actor 유지; A: token/session 무효; O: 기존 event 수신 가능성 | 권한 우회·stale 연결 | `P`: 장기 연결도 Auth 상태를 재검증하고 만료 시 mutation 차단 후 connection 종료. 새 인증 뒤 재접속/catch-up | 감지 미구현 |
| FS-CON-004 | heartbeat ACK 미도착 | C/G 모두 실제 생존을 확정 못 함; A/O: 변화 없음 | zombie, 누락 지연 | Heartbeat를 채택할 경우 deadline 뒤 연결 폐기와 새 session 재접속/catch-up이 필요하다. 도입 여부·주체·deadline은 `미결정` | heartbeat 미구현 |
| FS-CON-005 | TCP는 열렸지만 양방향 통신 불가 | C: READY로 오인; G: local session 잔존; A: 새 명령 없음; O: 발신자 부재로 관찰 | zombie·메모리 점유 | heartbeat 또는 idle 판정을 채택한다면 socket을 폐기하고 catch-up하며 offline/reconnecting을 표시한다. 도입 방식은 `미결정` | 미구현 |
| FS-CON-006 | 서버가 연결 갱신 또는 재연결 요청 | C: READY→RECONNECTING; G: 기존 session 정리; A: 저장 유지; O: 영향 없음 | 짧은 event gap | `P`: reconnect intent를 받은 Client가 새 ticket/session을 만들고 재구독 후 cursor catch-up | 정상 shutdown close 1001만 있음 |
| FS-CON-007 | Gateway 프로세스 재시작 | C: socket close; G: session/subscription 전부 소실; A: commit 메시지 유지; O: 해당 Gateway 연결만 끊김 | live delivery 누락 | 새 ticket→새 session→재구독→stream catch-up. session resume 없음. “재연결 중” | 현행 복구 경로 |
| FS-CON-008 | 재접속은 성공했지만 기존 session resume 불가 | C: 새 generation; G: 새 session과 빈 구독; A: cursor 이후 저장 메시지 존재; O: 정상 | 구독·event gap | 현재의 정상 모델이다. 구독 복원 후 catch-up; invalid cursor면 full sync | transport session resume은 현행에 없고 P도 미채택 |

## 구독과 권한

| ID | 실패·주입 지점 | C / G / A / O 상태 | 위험 | 재시도·복구·사용자 표시 | 현행 |
| --- | --- | --- | --- | --- | --- |
| FS-SUB-001 | 존재하지 않는 대화 구독 | C: subscribing; G: 현행은 임의 ID를 Set에 추가; A: target 확인 안 함; O: 없음 | 가짜 stream 구독·저장 생성 | `P`: API 존재 확인 뒤 개념적인 구독 거절(`stream_unavailable`). 구체 wire 이름은 Open이며 자동 재시도 없음 | 방어 미구현 |
| FS-SUB-002 | 권한 없는 대화 구독 | C: 대화를 열려 함; G: 현행 local join; A: read 전면 허용; O: 민감 event 가능 | 정보 노출 | `P`: view+subscribe 판정 전에는 routing 등록/데이터 전송 금지. 대화 존재 여부를 과도하게 노출하지 않음 | 방어 미구현 |
| FS-SUB-003 | 구독 중 view 권한 회수 | C: stale 화면; G: stale Set; A: 외부 상태만 변경; O: 권한 actor에게 계속 전달될 수 있음 | 지속 정보 노출 | 회수 event로 local 구독 제거, buffer 폐기, 이후 Query/명령 재검증. suspended면 연결 종료 | 미구현 |
| FS-SUB-004 | subscribe 성공 응답 전에 연결 종료 | C: 성공 여부 모름; G: old session과 Set 제거; A: 판정했을 수 있음; O: 없음 | 모호한 subscription | 새 generation에서 subscribe를 다시 요청. subscription 명령은 connection-local 멱등 처리. catch-up 기준점 재획득 | 현행 ACK 자체 없음 |
| FS-SUB-005 | 같은 대화 중복 구독 | C: 중복 요청; G: 같은 Set entry; A: 목표 모델에서는 반복 판정; O: 중복 fan-out 가능성 | 중복 listener/event | 같은 connection+stream은 하나의 subscription으로 수렴하고 현재 상태 ACK 반환 | 현행 Set 추가는 멱등, ACK 없음 |
| FS-SUB-006 | unsubscribe 처리 결과가 유실되거나 처리 중 연결 종료 | C: 해제 성공 여부를 모름; G: 같은 연결이면 구독이 남았거나 제거됐고, 연결이 닫히면 session과 구독이 함께 제거됨; A: durable membership 변화 없음; O: 변화 없음 | 같은 연결이 살아 있으면 원치 않는 live event를 더 받을 수 있음 | 같은 connection에서는 unsubscribe를 결과상 멱등하게 재시도한다. 연결이 닫혔다면 새 session의 복원 대상에서 해당 Conversation을 제외하며 별도 transport session resume은 하지 않는다 | 명시적 unsubscribe와 결과 ACK 미구현 |

## 메시지 전송

| ID | 실패·주입 지점 | C / G / A / O 상태 | 중복·순서·유실 위험 | 재시도·복구·사용자 표시 | 현행 |
| --- | --- | --- | --- | --- | --- |
| FS-MSG-001 | A: 전송 직전 연결 종료 | C: optimistic `PENDING`; G/A: frame 미수신; O: 없음 | DB 유실 없음, 사용자 의도 미반영 | pending을 `FAILED_RETRYABLE`로 바꾸고 연결 후 같은 `idempotencyKey`로 사용자 재시도 | disconnect 시 failed |
| FS-MSG-002 | B: Gateway 수신 후 API 전달 실패 | C: pending; G: frame은 앎, commit 여부 없음; A/O: 없음 | 같은 명령 재시도 필요 | 인프라 실패를 command failure로 상관해 반환하는 것이 `P`; 현행은 socket 1011. 재접속 후 같은 키 재시도 | 현행 close 가능 |
| FS-MSG-003 | C: API가 저장하지 못함 | C: pending; G: API failure; A: rollback/no row; O: 없음 | sequence는 commit되지 않음 | retryable failure와 `idempotencyKey`를 상관해 같은 키 재시도. 사용자 “전송 실패—재시도” | API 503→Gateway 예외/1011 |
| FS-MSG-004 | D/G: 저장 성공 후 sender ACK 유실 | C: pending/failed; G: 응답 또는 socket send 유실; A: 메시지 존재; O: 일부는 created 관찰 가능 | 재전송 시 DB 중복 위험 | catch-up message만으로 optimistic item을 추측 제거하지 않는다. 같은 `idempotencyKey` 재전송→기존 `messageId/sequence` 반환 후 확정 | DB 멱등성·Web retry 구현 |
| FS-MSG-005 | ACK 유실로 같은 명령 재전송 | C: 같은 optimistic item; G: 새 요청; A: 기존 row 반환; O: 기존 created 재발행 없음 | DB·wire 중복 없음. 최초 live fan-out 유실은 남을 수 있음 | 같은 `idempotencyKey` 재전송으로 sender accepted를 다시 받고, 구독자의 event gap은 catch-up한다. 동일 key의 target/text도 같아야 한다 | 기존 메시지는 accepted만 반환하고 created fan-out 생략 |
| FS-MSG-006 | D/F: 저장 성공, 일부 구독자 전달 실패 | C sender: accepted; G: 일부 send failure; A: commit; O: 수신자별로 다름 | 일부 Client gap | 수신자가 다음 sequence gap/재접속을 통해 catch-up. accepted를 delivery 완료로 표시하지 않음 | local send 실패를 로그 후 무시 |
| FS-MSG-007 | 동일 created event 두 번 도착 | C: 같은 identity 재수신; G/A: 하나의 저장 row; O: 중복 관찰 가능 | unread/화면 중복 | `messageId↔sequence` identity가 같으면 drop; 불일치면 protocol failure/full sync 검토 | timeline dedupe 구현 |
| FS-MSG-008 | message event 순서 역전 | C: cursor보다 미래 sequence 수신; G: send scheduling/경로 순서 다름; A: DB 순서는 확정; O: 서로 다른 순서 가능 | 화면 순서 역전 | 미래 event buffer, 연속 구간만 apply. gap을 catch-up한 뒤 drain | timeline buffer 구현 |
| FS-MSG-009 | 중간 sequence 누락 | C: cursor gap; G: 누락 인지 못할 수 있음; A: 연속 rows 존재; O: 각기 다름 | 한 message 미표시 | `afterSequence` catch-up, fixed watermark page 적용. 연속성 위반은 protocol failure | gap buffer·generation bootstrap sync는 구현. live gap 자체의 catch-up trigger는 미구현 `P` |
| FS-MSG-010 | 삭제 뒤 수정 명령 도착 | C: stale editable view; G: relay; A: deleted version; O: 삭제를 봤을 수 있음 | 삭제 사실 역전 | `P`: edit를 conflict/rejected로 종료하고 최신 tombstone 적용. 자동 재시도 안 함 | edit/delete 미구현 |
| FS-MSG-011 | 같은 sender가 기존 `idempotencyKey`를 다른 target 또는 text에 재사용 | C: 기존 optimistic item과 다른 의도; G: 유효 frame relay; A: 기존 row와 payload 불일치; O: 기존 message만 존재 | 키 충돌을 새 메시지로 저장하면 중복·의도 오염 | API가 `idempotency_conflict`로 거절하고 기존 canonical message는 변경하지 않는다. 자동으로 새 key를 만들거나 재시도하지 않음 | 구현 |
| FS-MSG-012 | 수정 중 다른 actor가 삭제 | C: edit pending; G: 두 명령을 relay; A: edit/delete 중 하나 선행; O: 순서에 따라 다름 | edit resurrection | `P`: 첫 commit의 version이 우선. 삭제 뒤 edit는 거절; Client는 tombstone 반영 | 미구현 |
| FS-MSG-013 | 잘못된 JSON/schema/field | C: 잘못된 command; G: parse 가능 여부에 따라 모름; A: strict schema 전에 도달 안 함; O: 없음 | 공격·state 없음 | request correlation을 신뢰할 수 있으면 command reject, frame 자체를 신뢰할 수 없으면 1008 close. 사용자 입력 오류와 protocol 오류 분리 | 현행 malformed frame/send는 1008 |
| FS-MSG-014 | frame 또는 text 허용 크기 초과 | C: pending 가능; G: frame max 또는 schema 거절; A: text 8KiB 검증/DB check; O: 없음 | 자원 고갈 | oversized frame은 1009, 상관 가능한 text validation은 `invalid_content`로 명령 거절. 자동 재시도 없음 | maxPayload·8KiB 계약 구현, WS mapping 부분 |
| FS-MSG-015 | reply/thread 명령 처리 전에 parent message가 삭제되거나 접근 불가가 됨 | C: stale parent에 답글을 작성 중; G: 명령을 relay; A: parent가 tombstone이거나 actor에게 비공개; O: 삭제를 이미 봤거나 변화 없음 | orphan reply·삭제된 thread 부활 | parent 상태와 권한을 transaction 경계에서 다시 확인하고 conflict 또는 공개 가능한 not-found로 거절한다. 최신 tombstone을 반영하며 같은 command를 자동 재시도하지 않는다 | reply/thread 미구현 |
| FS-MSG-016 | reaction 추가·제거가 target 삭제 또는 같은 reaction 명령과 경합 | C: optimistic reaction이 기준 상태와 다를 수 있음; G: 명령을 relay; A: target 삭제 또는 reaction이 이미 원하는 상태; O: 중복·역전 projection 가능 | ghost reaction·중복 count | target 삭제가 reaction보다 우선한다. actor+message+emoji 자연 key로 같은 add/remove를 결과상 멱등 처리하고 최신 projection으로 수렴한다 | reaction 미구현 |

### 메시지 실패 판정 규칙

| API 기준 상태 | Sender 결과 수신 | Other delivery | Client가 취할 행동 |
| --- | --- | --- | --- |
| commit 없음 | 실패/유실 | 없음 | 같은 멱등 키로 재시도 가능 |
| commit 있음 | accepted 수신 | 성공 여부 무관 | `SENT`; delivery 완료라고 표시하지 않음 |
| commit 있음 | accepted 유실 | 일부 성공 가능 | 실패/미확정 표시 후 같은 키 재시도 |
| commit 여부 불명 | 결과 유실 | 불명 | 새 키를 만들지 말고 같은 키로 조회/재시도 |

## 오프라인·동기화

| ID | 실패·주입 지점 | C / G / A / O 상태 | 위험 | 재시도·복구·사용자 표시 | 현행 |
| --- | --- | --- | --- | --- | --- |
| FS-SYNC-001 | 오프라인 중 메시지 생성 | C: cursor 정지; G: session 없음; A: 새 sequence commit; O: online만 수신 | offline Client 누락 | 같은 page runtime의 재접속은 메모리 cursor부터 catch-up. browser reload 뒤에는 cursor가 없어 latest부터 다시 읽음 | page-lifetime cursor 범위에서 구현 |
| FS-SYNC-002 | 오프라인 중 메시지 수정 | C: old version; G: offline Client session 없음; A: edited fact 존재; O: online은 새 version | stale 내용 | `P`: replay 가능한 `MessageEdited` 또는 snapshot으로 복구 | edit/replay 미구현 |
| FS-SYNC-003 | 오프라인 중 메시지 삭제 | C: old message; G: offline Client session 없음; A: delete fact/tombstone; O: online은 삭제 관찰 | 삭제 원문 잔존 | `P`: delete fact를 ordering에 포함해 catch-up/full sync에서 제거 | delete/replay 미구현 |
| FS-SYNC-004 | replay 가능한 범위 밖 cursor | C: 오래된 cursor; A: 해당 event 범위 없음; G: sync rejected; O: 정상 | 부분 snapshot으로 gap을 메울 수 없음 | `FullSyncRequired`; local cursor/buffer 폐기 후 권한 범위 snapshot 재구성 | 현재 message row를 보존해 일반 발생 조건 없음 |
| FS-SYNC-005 | Client delivery cursor가 server head보다 앞섬 | C: 손상/stale namespace delivery cursor; A: `invalid_cursor`; G: rejected relay; O: 정상 | 잘못된 skip | 자동 같은 cursor 재시도 금지. full sync 후 새 delivery cursor 저장 | sync-after invalid_cursor 구현, 자동 full sync 미구현 |
| FS-SYNC-006 | Client가 기대한 session과 server session 불일치 | C: old session metadata; G: 매 연결 새 ID; A: session 기준 없음; O: 정상 | session resume 오해 | stable session을 복원하려 하지 않고 actor+channel delivery cursor로 catch-up. 권한 변화 시 full sync | 현행 모델 |
| FS-SYNC-007 | older history의 `beforeSequence`가 유효하지 않거나 조회 중 history 권한이 바뀜 | C: 기존 timeline과 delivery cursor는 유효하고 older 요청만 실패; G: public HTTP 경로라 local session 변화 없음; A: `invalid_cursor` 또는 `stream_unavailable`; O: 변화 없음 | 과거 page 공백 또는 반복 실패 | 같은 history cursor의 자동 반복을 멈춘다. 접근 가능 상태를 다시 확인하고 필요하면 authoritative latest/history 경계에서 pagination만 다시 시작한다. 이 실패만으로 delivery cursor를 폐기하거나 Full Sync하지 않는다 | older API 거절과 Client `olderFailed` 표시는 구현, capability 판정 미구현 |

## 임시 상태·읽음·권한

| ID | 실패·주입 지점 | C / G / A / O 상태 | 위험 | 재시도·복구·사용자 표시 | 현행 |
| --- | --- | --- | --- | --- | --- |
| FS-EPH-001 | 한 actor가 typing 시작·종료 event를 과도하게 전송 | C: typing 상태를 반복 전송; G: coalescing·rate limit 없이 fan-out할 수 있음; A: 일반 message 기준 상태 변화 없음; O: ephemeral event 폭증 | fan-out 자원 고갈·UI 깜빡임 | actor+Conversation 최신 상태로 coalesce하고 typing 전용 rate limit을 적용한다. 상관 가능한 거절 또는 drop을 사용하며 반복 악용 전에는 connection 전체를 닫지 않는다 | typing과 전용 limiter 미구현 |
| FS-EPH-002 | typing stop event가 유실되거나 start/stop 순서가 역전 | C: 이미 입력을 멈춤; G: 마지막 start만 알고 있거나 상태 없음; A: durable message 상태 변화 없음; O: stale typing indicator | 사용자가 계속 입력 중으로 보임 | typing은 replay하지 않고 TTL 만료와 actor+Conversation 최신 상태 우선 규칙으로 제거한다. TTL·generation wire는 `미결정` | typing 미구현 |
| FS-READ-001 | read cursor가 뒤로 이동하거나 server head·접근 범위를 벗어난 위치를 가리킴 | C: 잘못된 unread 감소 또는 read marker 이동을 시도; G: 명령 relay 가능; A: 기존 actor+Conversation cursor와 head 유지 | unread 유실·권한 밖 위치 노출 | cursor는 단조 증가만 허용하고 접근 가능한 committed sequence까지만 받는다. 거절 시 authoritative read cursor를 재조회하며 delivery cursor를 폐기하거나 Full Sync하지 않는다 | read cursor 미구현 |
| FS-AUTH-001 | 접속 중 write capability가 회수됐지만 stale Gateway 또는 in-flight 명령이 전송됨 | C: pending mutation; G: stale 구독·capability로 relay할 수 있음; A: 권한 version과 commit 순서에 따라 거절하거나 이미 commit; O: commit된 경우에만 사실 관찰 | 회수 뒤 무단 쓰기 또는 성공 결과 오판 | mutation transaction에서 현재 capability를 다시 판정한다. 회수 전에 commit된 사실은 유지하고 이후 명령은 거절한다. ACK 유실 재시도는 기존 결과 조회와 새 mutation 권한 판정을 분리한다 | capability provider·회수 전파 미구현 |

## 처리 지연과 흐름 제어

| ID | 실패·주입 지점 | C / G / A / O 상태 | 위험 | 재시도·복구·사용자 표시 | 현행 |
| --- | --- | --- | --- | --- | --- |
| FS-FLOW-001 | Client가 event를 너무 느리게 소비 | C: cursor 지연; G: outbound buffer 증가; A: 정상 commit; O: 정상/지연 | Gateway 메모리·지연 증가 | `P`: buffered amount 상한을 넘으면 slow-consumer 오류 후 연결 종료, 새 연결에서 catch-up | backpressure 판정 미구현 |
| FS-FLOW-002 | 한 actor가 메시지를 연속 과다 전송 | C: 다수 pending; G/A: 요청 쇄도; O: event 폭증 | 자원 고갈·공정성 | `P`: actor/대화 기준 rate limit, 상관 가능한 command rejection과 retry hint. 연결 전체 종료는 반복 악용 시만 | send rate limit 미구현 |
| FS-FLOW-003 | 많은 Client가 동시에 재접속 | C: reconnecting; G/API: ticket/sync 부하; A: 기준 상태 유지; O: 각자 gap | 재접속 폭주 | Client backoff+jitter, server reconnect hint, page catch-up과 bounded batch. 상태 손실 이유로 full sync를 남발하지 않음 | client backoff/bounded recovery 일부 구현 |

## 공통 복구 결정표

| 조건 | 같은 명령 재시도 | 새 Gateway session | catch-up | full sync | 연결 종료 |
| --- | --- | --- | --- | --- | --- |
| command validation/authorization 거절 | 아니오 | 불필요 | 불필요 | 불필요 | 원칙상 유지 |
| commit 전 일시 장애 | 같은 멱등 키 | 연결이 끊겼다면 | 연결 뒤 수행 | 보통 불필요 | transport 상태에 따름 |
| commit 후 ACK 유실 | 같은 멱등 키 | 연결이 끊겼다면 | 예 | 불필요 | 기존 연결 상태에 따름 |
| 일부 fan-out 유실/sequence gap | 명령 재시도 아님 | 필요 시 | 예 | catch-up 불가 때만 | 불필요 |
| invalid/out-of-range cursor | 아니오 | 이미 새 session일 수 있음 | 같은 cursor 반복 금지 | 예 | 불필요 |
| 권한 회수 | write 재시도 금지 | suspended면 새 연결도 금지 | 허용 stream만 | 권한 projection 재구성 | 전체 principal 접근 회수 시 종료; 세부 signal은 미결정 |
| protocol identity 충돌 | 아니오 | 기본값은 아니오 | 자동 catch-up 중단 | 자동 full sync 안 함 | 해당 Conversation 복구 중단; connection 종료 여부는 미결정 |

## 현행 gap 우선순위

| 우선 확인 | 이유 |
| --- | --- |
| subscribe 권한과 ACK | 현재 임의 channel ID가 권한 확인 없이 fan-out Set에 들어간다. |
| message infrastructure failure의 상관 응답 | 현재 API 실패가 command failure가 아니라 connection 1011로 번질 수 있다. |
| durable cross-Gateway delivery | commit 뒤 local Gateway 밖의 Client에게 실시간 전달할 경계가 없다. |
| heartbeat/zombie와 slow-consumer | 열린 socket을 실제로 사용 가능한 연결로 오인할 수 있다. |
| invalid cursor의 automatic full sync | Client가 현재 `invalid_cursor` phase에서 멈춘다. |
| edit/delete replay model | offline 변경을 sequence에 어떻게 포함할지 아직 없다. |

## 완료 기준

- 모든 실패가 C/G/A/O 네 관점으로 설명된다.
- commit 전 실패, commit 후 ACK 유실, 일부 fan-out 유실을 구분한다.
- 중복·역전·gap의 복구 기준이 `messageId + streamId + sequence`에 연결된다.
- 재시도 주체, session resume 여부, catch-up/full sync 조건, 사용자 표시가 있다.
- 현행에 없는 기능과 현재 방어가 없는 실패를 숨기지 않는다.
