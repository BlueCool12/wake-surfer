# Architecture

이 문서는 새 `docs/realtime-chat` 세계의 router node다. 현재는 설계 graph이므로 target path는
구현 후보이고, 실제 code edge는 아직 없다.

## Router

| Logical partition | Contract | Target path | Current edge |
| --- | --- | --- | --- |
| Chat command workflow | 권한 확인 후 stream lock, sequence 발급, message 저장, sender ACK 반환, delivery publish 시도까지의 application flow. | `packages/realtime-chat/src/workflow/send-chat-message-use-case.ts#SendChatMessageUseCase` | missing |
| Stream core | `ConversationStream`은 stream별 `lastSequence`를 소유하고 sequence 중복을 막는다. | `packages/realtime-chat/src/core/conversation-stream.ts#ConversationStream` | missing |
| Message core | `Message`는 `messageId` 전역 고유, `streamId + sequence` 정렬, `USER`/`SYSTEM` 타입을 가진다. | `packages/realtime-chat/src/core/message.ts#Message` | missing |
| Read cursor core | `ReadCursor`는 `lastReadSequence`를 뒤로 이동시키지 않는다. | `packages/realtime-chat/src/core/read-cursor.ts#ReadCursor` | missing |
| Chat persistence | stream row lock, message insert, idempotency key, read cursor upsert를 transaction으로 제공한다. | `packages/realtime-chat/src/persistence/chat-message-repository.ts#ChatMessageRepository` | missing |
| Gateway ticket persistence | ticket 원문 hash 저장과 `consumed_at IS NULL AND expires_at > now` 원자적 consume을 제공한다. | `packages/realtime-chat/src/adapters/rdb/rdb-gateway-ticket-adapter.ts#RdbGatewayTicketAdapter` | missing |
| Gateway workflow | WebSocket handshake에서 ticket consume 성공 시 local session을 등록한다. | `packages/realtime-chat/src/workflow/connect-gateway-session-use-case.ts#ConnectGatewaySessionUseCase` | missing in new world |
| Inbound gateway relay | gateway는 frame size, JSON parse, session 존재만 확인하고 chat command를 API로 넘긴다. | `packages/realtime-chat/src/workflow/submit-inbound-client-event-use-case.ts#SubmitInboundClientEventUseCase` | missing in new world |
| Outbound delivery | delivery event를 gateway server group으로 publish하고 각 gateway가 local session만 찾아 push한다. | `packages/realtime-chat/src/runtime/gateway-delivery-runtime.ts#GatewayDeliveryRuntime` | missing in new world |
| afterSequence sync | client가 stream별 last seen 이후 message를 다시 조회한다. | `packages/realtime-chat/src/workflow/sync-chat-stream-use-case.ts#SyncChatStreamUseCase` | missing |
| System message policy | `SessionStarted`를 idempotent하게 system message로 기록한다. | `packages/realtime-chat/src/workflow/post-system-message-use-case.ts#PostSystemMessageUseCase` | missing |
| Read model projection | timeline, channel list, DM list, unread badge projection을 eventual consistency로 갱신한다. | `packages/realtime-chat/src/projection/` | missing |

## External Context Edges

| External context | Chat depends on | Direction |
| --- | --- | --- |
| Auth / Ticket | authenticated user and ticket issue request | Auth -> Gateway Ticket |
| Workspace / Permission | `canWrite(actorId, stream owner)` and membership status | Chat -> Permission |
| Presence | user status events for display and optional broadcast | Presence -> Read model / delivery |
| Collaboration Session | `SessionStarted`, `SessionEnded` with workspace/channel/session id | Collaboration -> Chat system message policy |
| Broker / Event bus | publish/subscribe delivery event semantics | Chat -> Delivery -> Gateway |

## Runtime Shape

```txt
Client
  -> API: login / issue gateway ticket / chat commands / sync queries
  -> Gateway: WebSocket connect(ticket), socket events

Gateway
  -> RDB ticket consume
  -> local session registry
  -> API chat command relay
  -> socket push for local recipient sessions

Chat API
  -> Permission service
  -> RDB transaction for stream/message/read cursor
  -> Outbound event bus publish
```

## Path-table Drift

No current code path is accepted as implemented for this new world. Existing repository code may be
reused later, but this graph intentionally treats it as unmapped until a follow-up implementation
adds explicit doc -> code and code -> doc anchors.
