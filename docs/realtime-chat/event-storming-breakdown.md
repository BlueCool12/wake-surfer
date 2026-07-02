# Event Storming Breakdown

이 문서는 [domain-event-storming-report.md](domain-event-storming-report.md)를 graph node로
분해한 색인이다.

## Bounded Contexts

| Context | Type | Owned responsibility | Edge |
| --- | --- | --- | --- |
| Chat | Core | send message, validate write authority, persist ordered message, manage read cursor, create system message | depends on Permission, emits Delivery |
| Workspace / Membership / Permission | Supporting | workspace membership, role, channel access, write authority | queried by Chat before persistence |
| Presence | Supporting | ONLINE, AWAY, BUSY, OFFLINE state | consumed by UI/projection, triggered by session policy |
| Collaboration Session | Supporting | video and pair-programming session lifecycle | emits `SessionStarted` / `SessionEnded` to Chat |
| Realtime Gateway | Technical | WebSocket connect, ticket consume, local session, transport validation, socket push | relays to Chat, receives Delivery |
| Outbound Delivery | Technical | publish delivery events to gateway group | may be in-memory/mock in MVP, broker later |

## Aggregates And Models

| Model | Context | Responsibility | Critical invariant |
| --- | --- | --- | --- |
| `Workspace` | Permission | top-level collaboration space | not owned by Chat. |
| `WorkspaceMember` | Permission | membership and role | inactive member cannot write. |
| `Channel` | Chat or Permission boundary | public/private/archived channel policy | archived channel cannot receive normal user messages. |
| `ChannelMembership` | Permission | private channel membership | private channel is readable/writable only by participants. |
| `DMConversation` | Chat | one-to-one or group DM | one-to-one DM is unique for the participant pair; group DM max is 10. |
| `ConversationStream` | Chat | message order for channel, DM, or thread | sequence is unique and increasing only inside one stream. |
| `Message` | Chat | user/system message record | unauthorized message is not stored. |
| `ReadCursor` | Chat | per-user read position | `lastReadSequence` never decreases. |
| `GatewayTicket` | Gateway / Auth | one-time WebSocket access | expired or consumed ticket is rejected. |
| `GatewaySession` | Gateway runtime | local socket session mapping | local to one gateway process. |

## Command And Event Map

| Flow | Command / input | Component | Event / output |
| --- | --- | --- | --- |
| connect | `IssueGatewayTicket` | Gateway ticket adapter | `GatewayTicketIssued` |
| connect | `ConsumeGatewayTicket` | Gateway ticket adapter | `GatewayTicketConsumed` or `WebSocketConnectionRejected` |
| connect | `RegisterGatewaySession` | Gateway session registry | `GatewaySessionRegistered` |
| send | `GatewayMessageReceived` | Gateway transport | `SendChannelMessage` relay |
| send | `SendChannelMessage` | Chat workflow | `ChatMessageSent` or `ChatMessageRejected` |
| send | `ChatMessageSent` | Delivery policy | `OutboundMessageDeliveryRequested` |
| delivery | `OutboundMessageDeliveryRequested` | Outbound event bus | `MessagePushedToSocket` or skipped |
| read | `ChannelOpenedByUser` | Client / Chat | `MarkChannelAsRead` |
| read | `MarkAsRead` | Read cursor workflow | `ReadCursorAdvanced` or no-op |
| session | `SessionStarted` | System message policy | `SystemMessageCreated` |
| presence | `GatewaySessionRegistered` first active session | Presence policy | `UserStatusChanged(ONLINE)` |

## MVP Slices

| Slice | Must include | Done when |
| --- | --- | --- |
| MVP 1: RDB Gateway Ticket | issue, hash store, atomic consume, reject expired/reused ticket | concurrent consume succeeds once. |
| MVP 2: Stream Message Store | stream row, message row, sequence transaction | channel/DM/thread streams sequence independently. |
| MVP 3: Message Idempotency | `clientMessageId`, idempotency key, retry lookup | retry returns existing accepted result. |
| MVP 4: Realtime Delivery | outbound event bus, gateway local session lookup, socket push | publish failure does not roll back saved message. |
| MVP 5: afterSequence Sync | last seen sequence, stream query, sync response | missed pushed messages are recovered. |

## Implementation Gaps

| Gap | Why it matters | Target graph node |
| --- | --- | --- |
| No actual code edge for this new world | docs cannot yet drill down to file/symbol | [architecture.md](architecture.md) |
| No schema for command/event contracts | API and socket payloads can drift | [api.md](api.md) |
| No persistence transaction contract in code | stream sequence correctness depends on it | [constraints.md](constraints.md) |
| No test command | acceptance scenarios are not executable | [testing.md](testing.md) |
| Permission context boundary unresolved | Chat cannot safely validate write access without it | [overview.md](overview.md) |
| Outbox deferred | publish failures are recoverable but not replayed automatically | [internals.md](internals.md) |
