# Overview

이 문서는 [domain-event-storming-report.md](domain-event-storming-report.md)를 새
실시간 채팅 설계 세계의 소유권 경계로 압축한다.

## Source Of Truth

리포트 뒤쪽의 `결정사항 반영 요약`과 `최종 설계 결론`이 앞쪽 후보를 덮어쓴다.

확정된 기준:

| Area | Decision |
| --- | --- |
| Message order | 전역 sequence가 아니라 `streamId + sequence`를 쓴다. |
| Stream unit | Channel, DM, Thread는 모두 `ConversationStream`이다. |
| Idempotency | user message는 `senderId + streamId + clientMessageId`로 중복 저장을 막는다. |
| Read state | `ReadCursor(userId, streamId, lastReadSequence)`는 앞으로만 간다. |
| Gateway ticket | MVP 1차 구현은 RDB 기반 one-time consume ticket이다. |
| Delivery failure | DB 저장 후 realtime publish 실패는 MVP에서 허용하고 afterSequence sync로 복구한다. |

## Ownership Boundary

| Context | Owned here | Not owned here |
| --- | --- | --- |
| Chat Context | message permission check orchestration, stream sequence, message persistence command, read cursor, system message creation | workspace role source data, user identity, presence state machine, WebRTC session lifecycle |
| Realtime Gateway Context | ticket consume call, local gateway session registry, transport validation, socket push | chat permission, message storage, sequence assignment |
| Outbound Delivery Context | delivery event publication and gateway fan-out contract | guarantee that every recipient received realtime push |
| Workspace / Permission Context | referenced as an external authority | implemented inside chat |
| Presence Context | status events consumed for chat UI projection | message ordering or message storage rules |
| Collaboration Session Context | `SessionStarted` / `SessionEnded` source event | session lifecycle implementation |

## Core Invariant

채팅 도메인의 책임은 사용자가 메시지를 보낼 수 있는지 검증하고, 메시지를 순서 있게
기록하고, 읽음 상태와 알림 상태를 관리하는 것이다. WebSocket, gateway session,
broker publish는 이 결과를 실시간처럼 보이게 하는 전달 인프라다.

## MVP Spine

1. RDB gateway ticket 발급과 원자적 consume.
2. `ConversationStream`별 message sequence 발급.
3. `clientMessageId` 기반 message idempotency.
4. 저장 성공 후 sender ACK와 outbound delivery publish 분리.
5. realtime delivery 실패 시 `afterSequence` sync로 복구.

## Explicit Non-goals

이 graph는 다음을 내부 구현으로 소유하지 않는다.

| Non-goal | Boundary |
| --- | --- |
| Auth 로그인 세부 | Auth / Ticket Context |
| Workspace membership 저장소 | Workspace / Permission Context |
| Presence status state machine | Presence Context |
| Video / pair programming runtime | Collaboration Session Context |
| 실제 broker provider 정책 | Outbound Delivery adapter |
| UI component locator | future chat UI graph에서 정의 |
