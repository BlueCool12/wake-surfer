# 12. 시나리오–이벤트 추적성 매트릭스

## 목적과 사용법

이 문서는 정상 시나리오를 실패, 권한, Command, Domain Event, Control Event, ordering, 멱등성, 재접속,
동기화 정책에 연결한다. 새 행동을 추가할 때 행 하나만 늘리는 것이 아니라 연결된 카탈로그와 실패
시나리오도 함께 갱신한다.

표기:

- `—`: 해당 시나리오에서 의도적으로 없음
- `P`: 프로젝트 결정이지만 현재 구현 완료를 뜻하지 않음
- `Current`: 2026-07-28 코드에서 확인됨
- `OD-*`: 마지막의 미결정 목록

## 연결과 초기화

| Scenario | Failure IDs | Actor | Permission | Command | Domain Event | Control Event | Ordering / Idempotency | Reconnect / Sync | Evidence | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-CON-001 | FS-CON-001, FS-CON-002 | Member | active principal | `IssueGatewayTicket`, `ConnectWithGatewayTicket` | `GatewayTicketIssued`, `GatewayTicketConsumed` | upgrade 결과 | ticket 원자 1회 소비; command dedupe 없음 | 실패 시 같은 ticket 대신 새 ticket | `P`; ticket 흐름 Current, verified Auth principal 미연결 | OD-001 |
| SC-CON-002 | FS-CON-003, FS-CON-004, FS-CON-005, FS-CON-007, FS-CON-008 | Member | active principal | `AuthenticateConnection`(논리) | — | `gateway.connected` | connection generation이 stale 결과 경계 | 예상 밖 close면 새 session | `P`; ready 흐름 Current, verified Auth principal 미연결 | OD-002 |
| SC-CON-003 | FS-SUB-002 | Member/Guest | `conversation:view` | `ListAccessibleConversations` | — | Query response | actor의 권한 projection version | 재접속 뒤 다시 조회 가능 | `P` | OD-003 |
| SC-CON-004 | FS-SUB-001, FS-SUB-002, FS-SUB-003, FS-SUB-004, FS-SUB-005 | Member | `conversation:view`, `conversation:subscribe` | `SubscribeConversation` (`JoinChannel` 현행) | — | 개념적 구독 성공/거절 결과; wire 이름 미결정 | connection+conversation 결과상 멱등 | 새 generation마다 재구독 | `P`; local join Current | OD-003,004 |
| SC-CON-005 | FS-SYNC-001, FS-SYNC-002, FS-SYNC-003, FS-SYNC-004, FS-SYNC-005, FS-SYNC-006, FS-MSG-007, FS-MSG-008, FS-MSG-009 | Member | `conversation:view`, `conversation:subscribe`, `history:read` | `LoadLatestMessages`, `CatchUpConversation` (`SyncAfterMessages` 현행), `FullSyncConversation` | 저장된 `MessageCreated` facts 조회 | `chat.stream.synced/rejected/failed`, `FullSyncRequired` | `streamId+sequence`; requestId correlation; fixed watermark | cursor catch-up, invalid cursor면 full sync | `D`, `P`; 부분 Current | OD-004 |
| SC-CON-006 | FS-CON-003, FS-CON-006, FS-CON-007 | Member | 본인 connection | `CloseConnection` | — | close / `ConnectionClosing`(미결정) | connection-local | 명시 종료면 자동 재접속 없음 | `P`; close Current | OD-005 |
| SC-CON-007 | FS-SUB-006 | Member | 본인 subscription | `UnsubscribeConversation` | — | 개념적 구독 해제 결과; wire 이름 미결정 | connection+conversation 결과상 멱등 | 새 connection에서는 복원 대상에서 제외 | `P`; 명시 leave 미구현 | OD-004 |

## 메시지

| Scenario | Failure IDs | Actor | Permission | Command | Domain Event | Control Event | Ordering / Idempotency | Reconnect / Sync | Evidence | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-MSG-001 | FS-MSG-001, FS-MSG-002, FS-MSG-003, FS-MSG-004, FS-MSG-005, FS-MSG-006, FS-MSG-013, FS-MSG-014 | Member | `message:create` | `SendMessage` | `MessageCreated`; delivery 경계의 `OutboundMessageDeliveryRequested` | `chat.message.accepted/rejected` | actor+stream+`clientMessageId`; stream sequence | unknown commit은 같은 키 재시도 | `P`; channel text Current | OD-006 |
| SC-MSG-002 | FS-MSG-004, FS-MSG-005 | Author | SC-MSG-001과 동일 | `SendMessage` 결과 | `MessageCreated` | Commit ACK인 `chat.message.accepted` 또는 rejected | ACK 순서를 live event보다 신뢰하지 않음 | ACK 유실 시 같은 키; sync로 확인 | `P`, Current | OD-007 |
| SC-MSG-003 | FS-MSG-006, FS-MSG-007, FS-MSG-008, FS-MSG-009 | Subscriber | `conversation:view` | — | `MessageCreated` projection | `chat.message.created` | `messageId↔sequence` dedupe; gap buffer | 누락은 DB message catch-up | `P`; local fan-out Current | OD-008 |
| SC-MSG-004 | FS-MSG-010, FS-MSG-011, FS-MSG-012 | Author | `message:edit_own` | `EditMessage` | `MessageEdited` | Command accepted/rejected | expected message version | offline/gap에서 edit fact replay 또는 snapshot | `D`, `P` | OD-009 |
| SC-MSG-005 | FS-MSG-010, FS-MSG-012 | Author | `message:delete_own` | `DeleteMessage` | `MessageDeleted` | Command accepted/rejected | current version; 중복 delete 결과상 멱등 | tombstone/delete fact 동기화 | `D`, `P` | OD-009 |
| SC-MSG-006 | FS-SUB-003, FS-MSG-010, FS-MSG-012 | Moderator | `message:delete_any` | `DeleteMessage` | `MessageDeleted` | Command accepted/rejected | current version; deleting actor 기록 | 삭제 fact 동기화 | `P` | OD-010 |
| SC-MSG-007 | FS-SUB-003, FS-MSG-013, FS-MSG-015 | Member | `message:create` | `ReplyMessage` | reply relation을 가진 `MessageCreated` | Command accepted/rejected | 같은 conversation sequence와 client key | 일반 message와 동일 catch-up | `P` | OD-011 |
| SC-MSG-008 | FS-SUB-003, FS-MSG-013, FS-MSG-015 | Member | `thread:create`, `thread:reply` | `ReplyThreadMessage` | `ThreadCreated`, `MessageCreated` | Command accepted/rejected | thread stream ordering key | thread cursor 정책으로 catch-up | `D`, `P` | OD-011 |
| SC-MSG-009 | FS-SUB-003, FS-MSG-016 | Member/Moderator | `reaction:add`, `reaction:remove_own` 또는 `reaction:remove_any` | `AddReaction`, `RemoveReaction` | `ReactionAdded`, `ReactionRemoved` | Command accepted/rejected | actor+message+emoji 결과상 멱등 | 최신 reaction projection 또는 event sync | `D`, `P` | OD-012 |
| SC-MSG-010 | FS-SUB-003, FS-MSG-013 | Member | `mention:user` 또는 `mention:broadcast` | `SendMessage` | `MessageCreated`, 파생 `UserMentioned` | message accepted/rejected | message 멱등 키; mention 대상 구조 검증 | message와 함께 catch-up | `P` | OD-013 |
| SC-MSG-011 | FS-SUB-003, FS-SYNC-007 | Member | `conversation:view`, `history:read` | `LoadOlderMessages` | — | Query response | exclusive `beforeSequence`; delivery cursor와 분리 | 재접속 뒤 필요할 때 다시 조회 | pagination은 Current, capability 집행은 미구현 `P` | OD-017 |

## 임시 상태와 읽음

| Scenario | Failure IDs | Actor | Permission | Command | Domain/Ephemeral Event | Control Event | Ordering / Idempotency | Reconnect / Sync | Evidence | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-EPH-001 | FS-CON-005, FS-SUB-003, FS-EPH-001 | Member | `typing:publish` | `StartTyping` | `TypingStarted` (ephemeral) | — | actor+conversation 최신 상태, TTL | replay하지 않음 | `D`, `P` | OD-014 |
| SC-EPH-002 | FS-CON-005, FS-EPH-002 | Member/server timer | `typing:publish` | `StopTyping` 또는 만료 | `TypingStopped` (ephemeral) | — | 중복 stop 결과상 멱등 | reconnect 뒤 과거 typing 복원 안 함 | `D`, `P` | OD-014 |
| SC-EPH-003 | FS-CON-005, FS-CON-007, FS-FLOW-003 | actor의 active connection / 허용된 viewer | active principal, recipient `conversation:view`; 추가 범위 미결정 | connection/presence owner의 상태 갱신 | `PresenceChanged` (ephemeral) | — | actor 최신 상태; multi-device merge 미결정 | 과거 event replay 안 함; snapshot 필요 여부 미결정 | `D`, `P` | OD-018 |
| SC-READ-001 | FS-SUB-003, FS-READ-001 | Member | `read_cursor:update` | `AdvanceReadCursor` | `ReadCursorAdvanced` | Command accepted/rejected | actor+conversation cursor 단조 증가 | 서버 read cursor 기준 재조회 | `P` | OD-015 |
| SC-READ-002 | FS-MSG-007, FS-MSG-008, FS-MSG-009 | Member | `conversation:view` | — | `MessageCreated` + stored read cursor | — | unread는 identity dedupe 뒤 계산 | message catch-up 뒤 재계산 | `P` | OD-015 |
| SC-READ-003 | FS-CON-007, FS-READ-002 | 같은 actor의 Device A/B | `read_cursor:update` | `AdvanceReadCursor` | `ReadCursorAdvanced` | — | 사용자 단위 cursor merge | offline device는 다음 read-cursor sync에서 반영 | `P` | OD-015 |

## 권한과 다중 접속

| Scenario | Failure IDs | Actor | Permission | Command | Domain Event | Control Event | Ordering / Idempotency | Reconnect / Sync | Evidence | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-AUTH-001 | FS-AUTH-001, FS-MSG-004, FS-MSG-005 | Member/Role context | 변경 전 view/create | 외부 `ChangeCapability`; 이후 `SendMessage` | `ConversationPermissionChanged` | write command rejected | permission version; 기존 exact idempotent result 정책은 05 적용 | view가 있으면 catch-up 유지 | `P` | OD-003 |
| SC-AUTH-002 | FS-SUB-003 | Member/Membership context | 변경 전 view | 외부 `RevokeConversationAccess` | `ConversationAccessRevoked` | subscription 제거/필요 시 close | 권한 event version | 회수 stream replay 금지; 재연결 시 재판정 | `P` | OD-003 |
| SC-MULTI-001 | FS-CON-007, FS-CON-008 | 같은 actor의 복수 device | active principal | device별 connect/subscribe | ticket/session facts | device별 `gateway.connected` | connection generation 독립; client ID 충돌 금지 | device별 cursor catch-up | `P`; 복수 local session Current | OD-016 |
| SC-MULTI-002 | FS-MSG-006, FS-MSG-007, FS-MSG-008, FS-MSG-009 | 같은 actor의 Device A/B | `conversation:view`, `conversation:subscribe`, A의 `message:create` | `SendMessage` | `MessageCreated` | A commit ACK; A/B created | 동일 message identity, pending은 device-local | 누락 device catch-up | `P`; same-Gateway 부분 Current | OD-008 |
| SC-MULTI-003 | FS-MULTI-001 | 같은 actor의 Device A/B | 본인 session 관리 | `CloseConnection`, `LogoutDevice`, `LogoutAllDevices` | Auth session invalidation 외부 사실 | connection close | device session ID 또는 actor-wide revocation ID | 선택한 logout 범위만 재접속 차단 | `P` | OD-005,016 |

## Command coverage

이 표는 [08-command-event-catalog.md](./08-command-event-catalog.md)의 Command가 시나리오 없이 남지
않는지 확인한다.

| Command | Scenario |
| --- | --- |
| `IssueGatewayTicket` | SC-CON-001 |
| `ConnectWithGatewayTicket` / `AuthenticateConnection` | SC-CON-001, SC-CON-002 |
| `ListAccessibleConversations` | SC-CON-003 |
| `JoinChannel` / `SubscribeConversation` | SC-CON-004 |
| `UnsubscribeConversation` | SC-CON-007 |
| `LoadLatestMessages` | SC-CON-005 |
| `LoadOlderMessages` | SC-MSG-011 |
| `SyncAfterMessages` / `CatchUpConversation` | SC-CON-005, SC-MSG-003 |
| `FullSyncConversation` / `RequestFullSync` | SC-CON-005 |
| `CloseConnection` | SC-CON-006, SC-MULTI-003 |
| `SendMessage` | SC-MSG-001, SC-MSG-002, SC-MSG-007, SC-MSG-010, SC-MULTI-002 |
| `EditMessage` | SC-MSG-004 |
| `DeleteMessage` | SC-MSG-005, SC-MSG-006 |
| `ReplyMessage`, `ReplyThreadMessage` | SC-MSG-007, SC-MSG-008 |
| `AddReaction`, `RemoveReaction` | SC-MSG-009 |
| `StartTyping`, `StopTyping` | SC-EPH-001, SC-EPH-002 |
| `AdvanceReadCursor` | SC-READ-001, SC-READ-003 |
| `RestoreSubscription` | SC-CON-004, SC-CON-005 |
| `LogoutDevice`, `LogoutAllDevices` | SC-MULTI-003 |

`ResumeSession`이라는 transport command는 현재 프로젝트 결정에 채택하지 않는다. 이 문서에서 resume은
새 session에서 `RestoreSubscription + CatchUpConversation`을 수행하는 과정이다.

## Domain/Event coverage

| Event 또는 사실 | Scenario |
| --- | --- |
| `GatewayTicketIssued`, `GatewayTicketConsumed` | SC-CON-001, SC-CON-002 |
| `MessageCreated` | SC-MSG-001~003, SC-MSG-007, SC-MSG-008, SC-MSG-010, SC-MULTI-002 |
| `OutboundMessageDeliveryRequested` | SC-MSG-001, SC-MSG-003 |
| `MessageEdited` | SC-MSG-004 |
| `MessageDeleted` | SC-MSG-005, SC-MSG-006 |
| `ThreadCreated` | SC-MSG-008 |
| `ReactionAdded`, `ReactionRemoved` | SC-MSG-009 |
| `ReadCursorAdvanced` | SC-READ-001, SC-READ-003 |
| `ConversationPermissionChanged` | SC-AUTH-001 |
| `ConversationAccessRevoked` | SC-AUTH-002 |
| `MemberSuspended` | SC-AUTH-002의 전체 연결 종료 분기 |
| `TypingStarted`, `TypingStopped` | SC-EPH-001, SC-EPH-002 |
| `PresenceChanged` | SC-EPH-003, SC-MULTI-001, SC-MULTI-003 |
| `UserMentioned` | SC-MSG-010 |

`chat.message.created`는 독립 event record가 아니라 `MessageCreated` 저장 사실의 현재 Gateway wire
projection이다. 이 wire의 누락 복구는 동일 `eventId` replay가 아니라 DB message sync다.

## 실패 coverage

| Failure group | 정상 시나리오 |
| --- | --- |
| FS-CON-001,002 | SC-CON-001 |
| FS-CON-003 | SC-CON-002, SC-CON-006 |
| FS-CON-004,005,007,008 | SC-CON-002, SC-CON-005, SC-MULTI-001 |
| FS-CON-006 | SC-CON-002, SC-CON-004, SC-CON-005, SC-CON-006 |
| FS-SUB-001~005 | SC-CON-004, SC-AUTH-002 |
| FS-SUB-006 | SC-CON-007 |
| FS-MSG-001~006,013,014 | SC-MSG-001, SC-MSG-002 |
| FS-MSG-007~009 | SC-MSG-003, SC-CON-005 |
| FS-MSG-010~012 | SC-MSG-004~006 |
| FS-MSG-015 | SC-MSG-007, SC-MSG-008 |
| FS-MSG-016 | SC-MSG-009 |
| FS-SYNC-001~006 | SC-CON-005 |
| FS-SYNC-007 | SC-MSG-011 |
| FS-EPH-001,002 | SC-EPH-001, SC-EPH-002 |
| FS-READ-001,002 | SC-READ-001, SC-READ-003 |
| FS-AUTH-001 | SC-AUTH-001 |
| FS-MULTI-001 | SC-MULTI-003 |
| FS-FLOW-001 | 모든 live subscription, 특히 SC-MSG-003 |
| FS-FLOW-002 | SC-MSG-001 |
| FS-FLOW-003 | SC-CON-001, SC-CON-005, SC-MULTI-001 |

## 보안 실패 coverage

[11-security-and-demo-data-policy.md](./11-security-and-demo-data-policy.md)의 `SEC-*` 시나리오를 기존
정상·실패 흐름과 명령 경계에 연결한다.

| Security ID | Failure / Scenario | Command 또는 경계 |
| --- | --- | --- |
| SEC-CON-001 | FS-CON-002 / SC-CON-001 | `ConnectWithGatewayTicket` |
| SEC-CON-002 | FS-CON-001 / SC-CON-001 | WebSocket upgrade Origin |
| SEC-CON-003 | FS-CON-002 / SC-CON-001 | `ConnectWithGatewayTicket`, ticket consume |
| SEC-INT-001 | FS-CON-002, FS-MSG-002 / SC-CON-001, SC-MSG-001 | internal ticket/message/sync HTTP |
| SEC-ACTOR-001 | 직접 대응 FS 없음 / SC-CON-001, SC-MSG-001 | `IssueGatewayTicket`, asserted actor 경계 |
| SEC-AUTHZ-001 | FS-SUB-002,003, FS-AUTH-001 / SC-CON-004, SC-AUTH-001,002 | `SubscribeConversation`, Query, mutation |
| SEC-AUTHZ-002 | 직접 대응 FS 없음 / SC-MSG-004~006 | `EditMessage`, `DeleteMessage` authorization |
| SEC-ROUTE-001 | FS-SUB-001,002, FS-MSG-013 / SC-MSG-001,004~010 | target·stream·message routing |
| SEC-PROTO-001 | FS-MSG-013 / SC-MSG-001 | WebSocket frame parser |
| SEC-SIZE-001 | FS-MSG-014 / SC-MSG-001 | frame·message content validation |
| SEC-FLOW-001 | FS-FLOW-002,003, FS-EPH-001 / SC-CON-001, SC-MSG-001, SC-EPH-001 | ticket·message·typing·sync rate limit |
| SEC-FLOW-002 | FS-FLOW-001 / SC-MSG-003 | Gateway outbound queue |
| SEC-SESSION-001 | FS-CON-003, FS-SUB-003, FS-AUTH-001, FS-MULTI-001 / SC-AUTH-001,002, SC-MULTI-003 | session 취소·subscription 회수 |
| SEC-REPLAY-001 | FS-MSG-004,005,007 / SC-MSG-001,002 | `SendMessage` idempotency |
| SEC-XSS-001 | 직접 대응 FS 없음 / SC-MSG-001,003,010 | 유효 message의 모든 output rendering |
| SEC-LOG-001 | FS-MSG-003,013 / SC-CON-001, SC-MSG-001 | API·Gateway·proxy logging |

## 미결정 목록

| ID | 질문 | 영향 Scenario | 결정될 때 함께 바꿀 문서 |
| --- | --- | --- | --- |
| OD-001 | 실제 Auth principal과 actorId 매핑·token 갱신 방식은 무엇인가? | CON-001 | 01, 05, 11 |
| OD-002 | heartbeat를 도입할 것인가? 도입한다면 주체, interval, deadline, server reconnect 신호는 무엇인가? | CON-002 | 04, 08, 09, 10 |
| OD-003 | Membership/Role provider 계약과 권한 변경 version은 무엇인가? | CON-003,004, AUTH-001,002 | 01, 05, 08, 11 |
| OD-004 | subscription 활성화·해제 결과의 wire/correlation과 latest/live 기준점을 하나의 계약으로 어떻게 고정하는가? | CON-004,005,007 | 04, 08, 10 |
| OD-005 | device logout과 actor 전체 logout을 구분할 stable session identity는 무엇인가? | CON-006, MULTI-003 | 04, 10, 11 |
| OD-006 | 채택한 payload fingerprint의 정규화·저장 형식과 `idempotency_conflict` wire 응답은 무엇인가? | MSG-001 | 05, 08, 09, 10 |
| OD-007 | optimistic `UNKNOWN_COMMIT`을 UI에서 별도 표시할 것인가? | MSG-002 | 04, 09, 10 |
| OD-008 | durable cross-Gateway delivery와 수신자 계산 경계는 무엇인가? | MSG-003, MULTI-002 | 01, 02, 08, 10 |
| OD-009 | 채택한 expected version의 wire 필드, tombstone 저장 표현과 mutation sequence 포함 방식은 무엇인가? | MSG-004,005 | 04, 08, 10 |
| OD-010 | moderation 삭제 감사 정보의 공개·보관 범위는 무엇인가? | MSG-006 | 05, 11 |
| OD-011 | 일반 reply relation과 독립 thread stream의 target 계약·parent summary 갱신을 어떻게 고정하는가? | MSG-007,008 | 01, 04, 08, 10 |
| OD-012 | reaction을 최종 상태로 sync할지 변경 event로 replay할지? | MSG-009 | 08, 10 |
| OD-013 | mention parsing과 알림 컨텍스트의 공개 계약은 무엇인가? | MSG-010 | 01, 08, 11 |
| OD-014 | typing TTL/rate/coalescing 정책은 무엇인가? | EPH-001,002 | 04, 08, 09 |
| OD-015 | actor 단위 read cursor의 영속·다른 device fan-out 계약을 history 제한과 어떻게 결합하는가? | READ-001~003 | 04, 05, 08, 10 |
| OD-016 | stable device ID가 필요한가, 필요하면 누가 소유하는가? | MULTI-001~003 | 01, 04, 10, 11 |
| OD-017 | older pagination cursor와 view/history 권한 변경 응답을 어떤 공개 계약으로 고정하는가? | MSG-011 | 04, 08, 09 |
| OD-018 | presence 공개 범위·상태 집합·multi-device merge·snapshot 계약은 무엇인가? | EPH-003, MULTI-001,003 | 03, 04, 08, 10 |

## 완료 검토

- 모든 SC ID가 최소 하나의 Failure, capability, Command/Event 또는 명시적 “없음”에 연결됐다.
- Command coverage에 시나리오가 없는 Command가 없다.
- Domain/Event coverage에 시나리오가 없는 채팅 사실이 없다.
- Failure group마다 정상 시나리오와 복구 문서가 있다.
- 11의 16개 `SEC-*` 시나리오가 정상·실패·명령 경계에 연결됐다.
- `chat.message.accepted`와 delivery, delivery cursor와 read cursor, Gateway session과 conversation resume을
  서로 구분한다.
- 미결정 항목은 구현 완료나 프로젝트 결정인 것처럼 숨기지 않는다.
