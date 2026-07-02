# Testing

이 문서는 새 realtime-chat 세계의 acceptance contracts다. 현재 이 디렉터리에는 실행 가능한
test command가 없다.

## MVP Test Matrix

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| stream sequence increments | `channel-ch-1.lastSequence = 10` | one message is stored | new message has `sequence = 11`. |
| independent stream sequences | `channel-ch-1.lastSequence = 10`, `dm-dm-1.lastSequence = 3` | both receive messages | channel gets 11 and DM gets 4. |
| concurrent sequence uniqueness | two writes target the same stream | both transactions commit | sequences are distinct. |
| message idempotency | an accepted message exists for `senderId + streamId + clientMessageId` | same command is retried | existing `messageId + sequence` is returned and no new message is inserted. |
| permission rejection | actor cannot write to private channel | `SendChannelMessage` is submitted | no message row and no delivery event are created. |
| read cursor monotonicity | cursor is at 45 | `MarkAsRead(sequence=30)` | cursor remains 45. |
| read cursor advance | cursor is at 30 | `MarkAsRead(sequence=45)` | cursor becomes 45 and `ReadCursorAdvanced` is emitted. |
| ticket one-time consume | one valid gateway ticket exists | two gateways consume concurrently | only one succeeds. |
| ticket expiry | ticket `expires_at` is in the past | gateway connect uses it | connection is rejected. |
| publish failure allowed | DB message commit succeeds | `OutboundEventBus.publish` fails | message remains committed and sender gets ACK. |
| afterSequence recovery | recipient saw sequence 100 and push for 101 failed | sync with `afterSequence=100` | response includes sequence 101. |
| system message idempotency | `SessionStarted(session-pair-123)` is processed once | same event is replayed | no duplicate system message is created. |

## Gateway Boundary Tests

| Test | Assertion |
| --- | --- |
| malformed JSON | gateway rejects at transport boundary before chat command. |
| oversized frame | gateway rejects at transport boundary. |
| missing session | gateway does not relay to Chat API. |
| valid session | gateway relays command without deciding channel permission. |
| recipient not local | gateway skips socket push without error. |
| sender ACK meaning | ACK is returned before proving recipient push success. |

## Persistence Tests

Use transaction-level tests for:

| Target | Required check |
| --- | --- |
| `conversation_streams` | row lock serializes next sequence for one stream. |
| `messages` | unique `(stream_id, sequence)` rejects duplicate sequence. |
| `message_idempotency_keys` | user and system keys map to exactly one message. |
| `read_cursors` | update condition prevents backward movement. |
| `gateway_tickets` | atomic consume update affects one row at most. |

## Residual Risk

No automated test command exists yet for this new graph. When implementation starts, add the concrete
command here and keep this matrix as the contract for unit, transaction, and gateway boundary tests.
