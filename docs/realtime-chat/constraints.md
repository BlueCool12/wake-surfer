# Constraints

이 문서는 변경 전 blast radius를 보기 위한 edge set이다.

## Blast Radius

| Surface | Consumers | Invariants |
| --- | --- | --- |
| `SendChannelMessage` | WebSocket gateway relay, Chat API handlers, message persistence, timeline projection, client pending-message UI | Permission check happens before persistence. ACK means stored and sequenced, not delivered to all recipients. |
| `ConversationStream` | message write transaction, message query, read cursor, unread projection, system message policy | `sequence` is unique and increasing only inside the same `streamId`. Different streams never compare sequence values. |
| `Message` | timeline read model, delivery event payload, idempotency lookup, sync API | `messageId` is globally unique. `streamId + sequence` is the display order. |
| `message_idempotency_keys` | retry handling, user message command, system message policy | Duplicate key returns existing result. User and system idempotency keys must not collide. |
| `ReadCursor` | unread count, channel/DM/thread open flow, sync recovery | `lastReadSequence` never decreases and is per user per stream. |
| `GatewayTicket` | API ticket issue route, gateway handshake, security logs | Raw ticket value is not persisted. One ticket consume can succeed only once. |
| `GatewaySessionRegistry` | gateway inbound validation, outbound delivery, presence online/offline policy | Registry is local to one gateway process unless explicitly replaced by shared presence infrastructure. |
| `OutboundEventBus` | Chat API delivery publish, gateway runtime subscription | Publish failure does not roll back message persistence in MVP. |
| `afterSequence sync` | reconnect flow, channel open flow, missed delivery recovery | Query returns persisted messages after the client-held sequence for that same stream. |
| `SystemMessageCreated` | collaboration session integration, timeline, delivery | Source event idempotency prevents duplicate system messages. |
| Permission edge | Chat commands, private channel, DM, thread reply | Gateway never replaces Workspace / Permission authority. |
| Presence edge | sidebar status display, optional broadcast, gateway session policy | Presence delay cannot affect message storage, sequence, or read cursor correctness. |

## Strong Consistency

These require strong consistency in the MVP:

| Area | Required behavior |
| --- | --- |
| Message persistence | accepted messages are durably stored. |
| Stream sequence | no duplicate sequence in one stream. |
| Message idempotency | same `senderId + streamId + clientMessageId` cannot create two messages. |
| Permission check | unauthorized messages are rejected before storage. |
| Gateway ticket consume | expired, reused, unknown, or mismatched tickets are rejected. |
| Read cursor | cursor update is monotonic. |

## Eventual Consistency

These may lag or fail temporarily:

| Area | Recovery |
| --- | --- |
| Realtime socket push | persisted messages are recovered by `afterSequence`. |
| unread projection | recompute from messages and read cursor. |
| Presence broadcast | latest status can be corrected by Presence view. |
| channel list preview | recompute from message stream. |
| system message push | persisted system message is visible on later sync. |

## Current Missing Edges

Because `docs/realtime-chat` is a new design world, every implementation edge is currently missing.
When code is added, update [architecture.md](architecture.md) target rows to actual paths and add a
short code comment anchor for non-obvious decisions such as stream sequence, ticket consume, and ACK
meaning.
