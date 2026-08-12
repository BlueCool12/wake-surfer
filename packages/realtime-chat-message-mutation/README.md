# @wake-surfer/realtime-chat-message-mutation

작성자가 자신의 메시지를 수정하거나 삭제하는 애플리케이션 유스케이스를 제공한다. 메시지 생성은
`@wake-surfer/realtime-chat-message-send`가 계속 담당한다.

## 공개 계약

- `createEditMessage(dependencies)` → `EditMessage`
- `createDeleteMessage(dependencies)` → `DeleteMessage`
- `MessageMutationAuthorizer`
- `EditedTextMessage`, `DeletedMessage`
- `EditMessageResult`, `DeleteMessageResult`

두 유스케이스는 transport 요청과 서버가 확인한 actor 문맥을 분리해서 받는다.

```ts
const editMessage = createEditMessage({ db, authorize });

const result = await editMessage(
  { messageId: "message-1", text: "수정한 내용" },
  { actorId: "actor-1" },
);
```

`authorize`는 DB에서 메시지 target을 확인한 뒤 mutation transaction 직전에 호출된다. 호출자는 전달된
target에 대한 현재 view 권한과 `message:edit_own` 또는 `message:delete_own` capability를 함께 판정해야
한다. 소유권과 활성·삭제 상태는 이어지는 DB transaction에서 다시 원자적으로 확인한다.

수정 성공은 `EditedTextMessage`, 삭제 성공은 `DeletedMessage`를 반환한다. 최초 삭제와 반복 삭제는 같은
tombstone 결과로 수렴하므로 공개 status로 구분하지 않는다. 삭제된 메시지를 수정하면 최신
`DeletedMessage`와 함께 `message_deleted`를 반환한다.

## 저장 경계

- 각 `usecase.ts`와 해당 `kysely.ts`가 애플리케이션 규칙과 원자 쿼리를 함께 소유한다.
- 별도의 repository/storage port를 두지 않는다.
- JSONB 본문은 message-send가 공개한 canonical persisted content codec을 사용한다.
- 수정과 최초 삭제만 server-managed version을 증가시킨다.
- 수정·삭제 시각은 PostgreSQL 서버 시각을 사용한다.
- 별도의 `state_kind`를 만들지 않고 `content`와 `deleted_at`의 물리 lifecycle을 따른다.
