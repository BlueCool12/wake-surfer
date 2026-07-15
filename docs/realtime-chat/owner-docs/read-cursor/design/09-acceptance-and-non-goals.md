# Read Cursor 설계: Acceptance criteria와 비범위

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## Mark 수용 시나리오

### 정상 전진과 no-op

- head 200, cursor 120에서 150을 mark하면 `advanced(150)`이다.
- cursor 150에서 150 또는 100을 mark하면 row와 `updated_at`을 바꾸지 않고 `unchanged(150)`이다.
- 100과 120이 동시에 처리되면 완료 순서와 무관하게 최종 cursor는 120이다.

### 빈 channel과 미래 cursor

- readable empty channel의 `mark(0)`은 row 없이 `unchanged(0)`이다.
- head 200에서 201을 mark하면 상태를 바꾸지 않고 `invalid_cursor`이며 실제 head를 노출하지 않는다.

### 권한과 identity

- channel 없음과 권한 없음은 같은 공개 거절이다.
- user A 요청은 user B cursor를 만들거나 바꾸지 않는다.
- client actor/user 필드는 신뢰하지 않는다.
- 사람 사용자로 해석할 수 없는 principal은 cursor를 만들거나 바꾸지 않는다.

## Client 수용 시나리오

### Latest baseline

- active·visible channel에서 latest 최대 5개가 merge/render되면 `throughSequence`를 mark한다.
- 로드하지 않은 더 오래된 sequence도 읽은 것으로 간주한다.
- inactive, hidden, merge/render 전에는 mark하지 않는다.

### 연속 적용

- 100까지 적용한 client가 102를 먼저 받으면 102를 mark하지 않는다.
- 101과 102가 연속 merge된 뒤 102까지 mark할 수 있다.

### Unread와 자기 메시지

- head 20, cursor 19이면 sequence 20 작성자가 같은 사용자여도 `hasUnread = true`다.
- 활성 sender 화면이 accepted/render 뒤 20을 mark하면 false가 된다.
- 정확한 unread count는 없다.

### 복구와 응답 범위

- 화면 진입/reload는 read-state Query로 cursor와 `hasUnread`를 복구한다.
- mark 결과는 요청한 연결에만 반환한다.
- 다른 탭·기기는 즉시 push가 아니라 각자의 진입/reload Query로 수렴한다.

## 필수 검증

- 실제 PostgreSQL의 insert/advance/no-op/rollback
- 동시 100/120 요청의 최댓값 보존
- no-op `updated_at` 불변
- stream head 상한과 FK/table contract
- 권한 거절 전에 content/cursor query가 실행되지 않음
- API–Gateway actor assertion과 requester-only relay
- Web active/visible/merge/gap/sender accepted 동작

## 비범위

- DM/thread cursor
- bot/system/service principal
- exact unread count
- sender 제외 unread projection
- read receipt broadcast
- same-user device 즉시 push
- inbox/channel list projection
- retention/delete와 cursor reset protocol
- `ReadCursorAdvanced` event/outbox
