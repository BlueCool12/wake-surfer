# Internals

이 문서는 리포트에서 확정된 decision과 그 이유만 남긴다.

## Decisions

| Decision | Reason |
| --- | --- |
| Chat owns validation orchestration, ordered persistence, read state, notification state. | Gateway and broker make chat realtime, but they are not the domain authority. |
| Use `streamId + sequence`, not global sequence. | Users read one channel, DM, or thread at a time; global ordering creates avoidable contention. |
| Treat Channel, DM, and Thread as `ConversationStream`. | The write path, read cursor, pagination, and sync recovery share the same ordering model. |
| Lock one stream row to assign next sequence. | Contention is scoped to the active conversation, not the whole service. |
| Require `clientMessageId` for user messages. | Network retry after stored-but-unacknowledged writes must not duplicate messages. |
| Store idempotency keys separately enough to support system messages. | System messages may not have `senderId` or `clientMessageId`. |
| Sender ACK is separate from recipient delivery. | ACK confirms validation, persistence, and sequence assignment only. |
| MVP permits publish failure after message commit. | The message is recoverable by `afterSequence`; outbox can be added later. |
| RDB gateway ticket is the MVP default. | API issues and gateway consumes across processes, so in-memory state is not sufficient. |
| Store ticket hash, not raw ticket value. | A DB leak should not reveal immediately usable gateway tickets. |
| JWT signed ticket is a future extension, not the MVP default. | Pure JWT cannot guarantee one-time consume without `jti` storage. |
| Read cursor is private per-user state. | The product chooses Slack-style unread state, not public per-message read counts. |
| Presence is display/projection input. | Presence changes must not affect message persistence or ordering. |
| Collaboration session creates idempotent system messages. | Replayed `SessionStarted` events should not create duplicate feed entries. |

## Rejected Or Deferred

| Option | Status | Reason |
| --- | --- | --- |
| Global message sequence | rejected for MVP | It creates a central bottleneck and is not needed for per-stream timelines. |
| In-memory ticket store as deployed default | rejected for new world | API and gateway can run in different processes. |
| Realtime delivery as part of ACK meaning | rejected | Offline recipients and publish failures are normal and recoverable. |
| Outbox pattern in MVP | deferred | Correct long-term answer, but direct publish plus sync recovery is acceptable for MVP. |
| Public read receipts | not selected | Read cursor is private unread state. |

## Implementation Intent

The first useful implementation should make the message write transaction boring and strict:

```txt
check permission
resolve streamId
lock ConversationStream
assign next sequence
persist Message
record idempotency key
return sender ACK
try outbound publish
```

Any abstraction that makes this path harder to inspect is suspect until this transaction is covered
by tests.
