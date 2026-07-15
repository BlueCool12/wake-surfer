# Read Cursor 구현 계획: 계획 역할과 고정 결정

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 계획 역할

이 계획은 Accepted Read Cursor 결정을 실제 GitHub 이슈와 PR로 옮긴다. 하나의 이슈는 독립적으로 검증
가능한 결과 하나를 만들며, 계약·provider·adapter·consumer를 명시적으로 나눈다.

- `@wake-surfer/realtime-chat-read-cursor-contracts`가 client/process boundary schema와 DTO를 소유한다.
- `@wake-surfer/realtime-chat-read-cursor`가 두 usecase, table contract, Kysely query, HTTP/WS registration을
  소유한다.
- `@wake-surfer/realtime-chat-database`는 table type과 migration을 합성하되 feature query를 소유하지 않는다.
- API/Gateway app은 runtime resource와 package mount만 소유한다.
- Web은 read observation과 transport를 소유하되 서버 cursor를 local source of truth로 대체하지 않는다.
- 각 기능 이슈는 자기 단위·통합 테스트와 필요한 문서 변경을 포함한다.

실제 이슈 생성 시 assignee는 `yullraes`, PR reviewer는 `BlueCool12`, `chan0324`다.

## 구현 중 바꿀 수 없는 결정

| 항목 | 확정값 |
| --- | --- |
| target | MVP channel-only, selector `channelId` |
| slices | `mark-read-cursor` Command와 `get-channel-read-state` Query |
| principal | 인증된 사람 사용자만, stable canonical `userId` |
| aggregate key | `(userId, streamId)` |
| mark 의미 | `S` 이하 전체를 읽은 것으로 간주 |
| cursor | 감소 금지, state-based natural idempotency |
| 상한 | primary stream head 초과는 `invalid_cursor`, clamp 금지 |
| 빈 channel | head 0, `mark(0)`은 row 없는 `unchanged(0)` |
| latest baseline | active·visible 상태에서 최대 5개 merge/render 뒤 head까지 mark |
| sync/live | gap 없는 최대 연속 applied sequence까지만 mark |
| unread | `hasUnread = head > cursor`, exact count 없음 |
| 자기 메시지 | Handler 예외 없음, 활성 sender가 accepted/render 뒤 mark |
| 복구 | 화면 진입/reload에서 별도 read-state Query |
| response | requester-only, same-user device push 없음 |
| event | `ReadCursorAdvanced`와 read receipt broadcast 없음 |
| DB | primary PostgreSQL 조건부 upsert, no-op `updated_at` 불변 |
| transport | mark는 WebSocket→Gateway→authenticated internal HTTP, read-state는 public HTTP |
