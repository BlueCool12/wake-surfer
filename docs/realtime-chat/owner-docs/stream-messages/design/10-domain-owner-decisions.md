# Stream Messages 설계: Domain Owner 결정

> [설계 index](./README.md) | [구현 이슈 index](../implementation/README.md)

## 18. Domain Owner Decision Record

아래 표의 모든 항목은 `확정` 상태다.

도메인 결정권자는 2026-07-14에 명시적으로 답한 항목 외의 모든 권고안도 일괄 승인했다. “과거
가시범위는 없음”은 **과거 조회 제한이 없음**, 즉 현재 읽기 권한이 있으면 저장된 전체 history를 조회할 수
있다는 의미로 기록한다.

| ID | 결정 항목 | 검토 당시 권고안 | 결정 |
| --- | --- | --- | --- |
| SM-01 | slice 경계 | latest / after / older를 세 Query+Handler로 분리 | **확정 — 세 Query를 각각 독립 input·output·Handler를 가진 slice로 분리한다.** |
| SM-02 | MVP target 범위 | storage/query는 channel·DM·thread 공통, 공개는 authorizer가 준비된 target부터 | **확정 — MVP 공개 조회 대상은 channel만이다. DM과 thread는 제외한다.** |
| SM-03 | Query selector | 세 Query 모두 target selector를 받고 server가 stream resolve | **확정 — MVP는 `channelId`를 받고 server가 canonical stream을 resolve하며 response에 `streamId`를 반환한다.** |
| SM-04 | initial load | `afterSequence=0` 전체 sync가 아니라 현재 head 기준 latest N개 | **확정 — 현재 head 기준 최신 최대 5개를 반환한다. initial limit은 client가 선택하지 않는다.** |
| SM-05 | cursor 모델 | `deliverySyncCursor`, `historyBeforeCursor`, `ReadCursor`를 분리 | **확정 — 세 cursor를 서로 다른 상태로 유지한다.** |
| SM-06 | cursor 비교/정렬 | after/before 모두 exclusive, 모든 response는 sequence ASC | **확정 — after/before는 모두 exclusive이고 모든 page는 sequence 오름차순이다.** |
| SM-07 | after/older page limit | 기본 50, 최대 100, N+1 row로 `hasMore` 판정 | **확정 — 기본 50, 최대 100이며 N+1개 조회 후 최대 N개를 반환한다.** |
| SM-08 | after snapshot 신뢰 수준 | stateless numeric `throughSequence`를 범위 검증; 발급 증명이 필요하면 opaque token 선택 | **확정 — 첫 버전은 numeric `throughSequence`를 매 page 범위 검증하며 opaque token은 사용하지 않는다.** |
| SM-09 | 빈 stream | target이 존재하고 읽을 수 있으면 stream row가 없어도 빈 성공 | **확정 — 빈 channel은 placeholder로 표현하지 않고 빈 message page로 응답한다. 빈 thread는 SM-22의 예외다.** |
| SM-10 | 권한/은닉 | content 조회 전 authorize, not-found/forbidden은 `stream_unavailable`로 통합 | **확정 — 조회 전 authorize하고 외부 오류는 `stream_unavailable`로 통합한다.** |
| SM-11 | canonical message contract | Query envelope은 독립, message item은 별도 공통 public contract로 승격 | **확정 — Query envelope은 독립 소유하고 message item은 versioned 공통 public contract가 소유한다.** |
| SM-12 | transport | Handler는 중립; latest/older HTTP와 after WebSocket relay를 우선 제공 | **확정 — Handler는 중립으로 유지하고 latest/older는 HTTP, after는 WebSocket relay로 공개한다.** |
| SM-13 | correlation | Query는 `requestId` 사용 | **확정 — Query correlation은 `requestId`를 사용한다.** |
| SM-14 | current history gap | retention이 없으므로 infrastructure/data-integrity failure로 처리 | **확정 — 현재 sequence gap은 infrastructure/data-integrity failure다.** |
| SM-15 | future retention | 이번 범위에서 제외하고 도입 시 reset/earliest cursor 계약 재결정 | **확정 — retention은 제외하고 도입 시 cursor/reset 의미를 다시 결정한다.** |
| SM-16 | sender correlation | history item에 `clientMessageId`를 노출하지 않고 동일 ID send retry로 pending 복구 | **확정 — history에 `clientMessageId`를 노출하지 않고 send 재시도로 pending을 복구한다.** |
| SM-17 | thread timeline projection | reply 본문은 thread stream에만, root `threadSummary`는 별도 결정/후속 범위 | **확정 — channel timeline에 `threadSummary`를 포함하지 않는다.** |
| SM-18 | client merge invariant | latest/sync/older/live/accepted가 하나의 sequence-aware merge model 사용 | **확정 — 모든 입력을 하나의 sequence-aware client merge model로 처리한다.** |
| SM-19 | response byte limit | page count와 별도로 serialized byte 상한 및 oversized single message 정책 정의 | **확정 — response 48KiB, text write 8KiB. oversized row는 skip/truncate 없이 data-integrity failure로 중단한다.** |
| SM-20 | older cursor 범위 | `1 <= beforeSequence <= headSequence + 1`, 범위 밖은 invalid cursor | **확정 — 해당 범위만 허용하고 범위 밖은 `invalid_cursor`다.** |
| SM-21 | 기존 sync cursor가 있는 진입 | latest로 건너뛰지 않고 after sync부터 수행; jump-to-latest만 명시적 reset | **확정 — 기존 cursor 이후 누락 복구를 먼저 수행한다.** |
| SM-22 | 빈 thread selector | 최초 panel은 `rootMessageId`로 resolve하고 reply가 없으면 빈 성공 | **확정 — 첫 reply로 thread가 생성된 뒤에만 조회한다. reply 없는 빈 thread 조회는 지원하지 않는다.** |
| SM-23 | 한 sync의 총량 상한 | 최대 page 수·message 수·총 byte와 중단/재개 의미 정의 | **확정 — 자동 recovery 한 묶음은 10 page, 500 message, 512KiB 중 먼저 도달한 상한에서 끊고 마지막 cursor부터 자동 재개한다.** |
| SM-24 | message variant 범위 | 첫 계약은 현재 USER/TEXT만; SYSTEM 도입 시 versioned union과 storage를 함께 확장 | **확정 — `USER/TEXT`만 지원하고 `SYSTEM`은 지원하지 않는다.** |
| SM-25 | read visibility 일관성 | page별 authorize; DM 등은 필요 시 minimum readable sequence를 authorizer 결과에 포함 | **확정 — 현재 읽기 권한이 있으면 저장된 전체 history를 조회한다. 재참여 이전을 포함해 과거 가시 범위 하한은 없다.** |
| SM-26 | cursor/limit validation | safe integer strict validation, maximum 초과 limit는 reject | **확정 — safe integer strict validation을 적용하고 limit 100 초과는 reject한다.** |
| SM-27 | cursor persistence 보장 | 최소 같은 로그인 세션의 reconnect/reload 범위까지 sync cursor 보존; 저장 기술은 후속 결정 | **확정 — `sessionStorage`에 actor/channel별 cursor와 진행 중 watermark만 저장하고 logout·계정 전환 때 폐기한다. Gateway session ID는 key로 사용하지 않는다.** |
| SM-28 | delayed pre-checkpoint event | cursor 이하·loaded window 밖 live event는 drop하고 older query에 맡김 | **확정 — 현재 window에 넣지 않고 drop하며 과거 조회는 older Query가 맡는다.** |
| SM-29 | Gateway actor assertion | authenticated gateway만 local-session actor를 internal API에 assert 가능 | **확정 — TLS와 별도 service bearer credential으로 인증된 Gateway만 server-only header로 local-session actor를 assert하고 client actor ID는 신뢰하지 않는다.** |

### 18.1 기술 제한값의 근거

- 현재 Gateway의 inbound WebSocket frame 상한은 64KiB이다. response envelope은 같은 transport 규모보다
  16KiB 작은 48KiB로 두되, 이 값은 Gateway 설정이 outbound에 자동 적용하는 것이 아니라 Query/adapter가
  최종 JSON 직렬화 뒤 직접 검사한다.
- 현재 API request body 상한은 16KiB이므로 text write를 UTF-8 8KiB로 제한해 envelope 여유를 둔다.
- 10 page의 page별 최대량은 480KiB이므로 누적 512KiB 상한 안에 들어간다.
- 기본 50 message의 10 page가 500 message이므로 page와 message 상한이 설명 가능한 한 묶음을 이룬다.
- byte 계산은 JavaScript 문자열 길이가 아니라 최종 JSON UTF-8 byte 수를 사용한다.

향후 확정 결정을 바꾸는 경우에는 다음 항목도 함께 기록한다.

- 바뀌는 외부 의미
- 호환성 영향
- 추가로 필요한 선행 domain/provider
- 이 문서의 어떤 acceptance criteria를 수정해야 하는지
