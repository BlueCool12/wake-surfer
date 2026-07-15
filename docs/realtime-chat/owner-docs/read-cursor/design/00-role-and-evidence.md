# Read Cursor 설계: 문서 역할과 근거

> [설계 index](./README.md) | [owner decisions](../decisions.md)

## 문서 상태와 역할

| 항목 | 값 |
| --- | --- |
| 상태 | **Accepted — Ready for implementation planning** |
| 대상 구현 단위 | `mark-read-cursor` Command slice와 `get-channel-read-state` Query slice |
| 결정일 | 2026-07-15 |
| 현재 구현 | 미구현 |

이 설계 묶음은 구현 계획이 따라야 할 승인된 도메인 의미와 경계다. 구현 이슈는 이 의미를 다시 선택지로
열지 않고 package, adapter, migration, Web 상태의 구체적인 위치와 작업 순서만 결정한다.

## 근거 우선순위

1. 현재 추적되는 package 코드와 package README
2. [현재 realtime-chat 아키텍처](../../../realtime-chat-architecture.md)
3. Stream Messages의 [owner decisions](../../stream-messages/decisions.md)와 관련 설계
4. [Message Send README](../../../../../packages/realtime-chat-message-send/README.md)
5. [Gateway Ticket README](../../../../../packages/realtime-chat-gateway-ticket/README.md)
6. `docs/realtime-chat/notes/`의 과거 flow 문서

`notes/`는 현재 계약이 아니라 사람용 배경 기록이다. 충돌하면 현재 코드, Accepted owner 결정, 공개 계약이
우선한다.

## 문서 경계

- 이 디렉터리는 owner-only 설계다.
- consumer-facing API와 불변조건은 구현 계약이 확정된 뒤 `public-docs/read-cursor/`에 별도로 추출한다.
- 이슈 작업자는 전체 설계를 읽지 않고 자기 이슈의 직접 선행 계약과 관련 설계만 읽는다.
- 기존 단일 문서는 이동 안내만 남기며 결정 원본으로 사용하지 않는다.
