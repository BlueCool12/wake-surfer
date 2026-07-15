# Read Cursor 설계: Domain Owner 결정

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## 상속하거나 구현으로 고정한 결정

| 근거 | 고정 내용 | 상태 |
| --- | --- | --- |
| Stream Messages target/selector | MVP는 channel-only, selector는 `channelId`, server가 canonical `streamId`를 resolve한다. | 상속 확정 |
| Stream Messages cursor/merge | delivery/history cursor와 ReadCursor를 분리하고 Query/live merge가 ReadCursor를 자동 갱신하지 않는다. | 상속 확정 |
| Stream Messages empty channel | readable empty channel head는 0이고 `mark(0)`은 row 없는 `unchanged(0)`이다. | 상속 확정 |
| Stream Messages auth | authorize-before-data, `stream_unavailable`, 짧은 권한 TOCTOU, trusted Gateway actor 경계를 사용한다. | 상속 확정 |
| Stream Messages integrity | gap은 data-integrity failure, retention/delete는 비범위, sequence는 safe integer로 검증한다. | 상속 확정 |
| ReadCursor 위치 | `mark(S)`는 모든 sequence `<= S`를 읽은 것으로 간주하며 message ID는 저장하지 않는다. | 도메인 확정 |
| PostgreSQL | primary DB 조건부 upsert로 최댓값을 보존하고 no-op은 `updated_at`을 바꾸지 않는다. | 구현 확정 |
| Command/transport | effective cursor와 `advanced/unchanged`, requester-only 응답, authenticated internal HTTP relay를 사용한다. | 구현 확정 |
| Schema/lifecycle | `(userId, streamId)` 복합 key, stream FK `NO ACTION`, event/retention은 MVP 비범위다. | 구현 확정 |

## 최종 도메인 결정

| ID | 질문 | 최종 결정 | 구현 결과 | 상태 |
| --- | --- | --- | --- | --- |
| MR-01 | 영속 주체와 principal | runtime actor를 stable canonical `userId`로 해석하고 사람 사용자만 허용한다. | bot/system/service account 비범위, `(userId, streamId)` key | **Accepted** |
| MR-02 | latest에서 언제 어디까지 mark하는가 | active·visible channel에서 latest 최대 5개가 merge/render되면 head까지 mark한다. 일반 sync/live는 연속 적용 위치까지만 mark한다. | Web read observation model 필요, viewport 추적 제외 | **Accepted** |
| MR-03 | unread 수준 | `head > cursor`인 `hasUnread`만 제공한다. | 정확한 count와 message별 projection 제외 | **Accepted** |
| MR-04 | 자기 메시지 | Handler는 특별 취급하지 않고 활성 sender 화면이 accepted/render 뒤 mark한다. | 다른 기기의 자기 메시지가 일시 unread일 수 있음 | **Accepted** |
| MR-05 | 재접속·다중 기기 수렴 | 화면 진입/reload에서 별도 `get-channel-read-state` Query를 호출한다. | 즉시 user-scoped push와 inbox projection 제외 | **Accepted** |

## 승인 기록

| 항목 | 기록 |
| --- | --- |
| 도메인 결정권자 | 사용자(도메인 결정권자) |
| 결정일 | 2026-07-15 |
| 승인 범위 | MR-01의 사람 사용자 전용 범위와 MR-02~MR-05 전체 |
| Stream Messages 변경 | 없음. 기존 Accepted 결정과 충돌하지 않는다. |

구현 이슈는 위 결정을 다시 대안 비교로 열지 않는다. 제품 의미를 바꿔야 하면 먼저 이 파일을 개정한다.
