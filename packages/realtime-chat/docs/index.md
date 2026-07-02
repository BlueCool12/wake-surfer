# Realtime Chat Docs Index

이 문서는 `packages/realtime-chat`의 사람이 읽는 문서 색인이다.

## Source

현재 문서는 [도메인 이벤트 스토밍 보고서](../../../docs/realtime-chat/domain-event-storming-report.md)의 최종 결정을 패키지 관점으로 옮긴다.

리포트 뒤쪽의 `결정사항 반영 요약`과 `최종 설계 결론`이 앞쪽 후보를 덮어쓴다.

## 현재 결정

| 결정 | 요약 |
| --- | --- |
| API와 Gateway 분리 | API는 business command와 persistence를 맡고, Gateway는 WebSocket connection state를 맡는다. |
| Gateway Ticket | MVP 배포 기준은 RDB 기반 one-time consume이다. in-memory ticket은 테스트/mock 전용이다. |
| 메시지 정렬 | 전역 sequence가 아니라 `streamId + sequence`를 사용한다. |
| Sender ACK | ACK는 저장과 sequence 발급 성공을 뜻하며, 모든 recipient push 성공을 뜻하지 않는다. |
| 배달 실패 | realtime publish 실패는 MVP에서 허용하고 `afterSequence` 조회로 복구한다. |
| Outbound bus | 단일 프로세스 검증은 in-memory/mock 가능. 실제 gateway server group 전파는 broker adapter가 필요하다. |

## 문서

- [Gateway Relay Architecture](gateway-relay-architecture.md)
  - API, Gateway, RDB, Permission, Outbound bus 사이의 책임 경계를 설명한다.
  - RDB ticket consume, stream sequence, sender ACK 의미를 정리한다.
- [게이트웨이 중계 흐름](gateway-relay-sequence.md)
  - 접속, 메시지 전송, 배달 실패 복구, 읽음 처리, system message 흐름을 Mermaid 다이어그램으로 표현한다.

## 기존 맥락

- [Research Notes](../../../apps/realtime-chat-api/docs/realtime-chat-research.md)
  - transport와 topology 후보를 비교한 리서치 문서다.
  - 특정 구현 결정을 고정하는 문서가 아니다.
- [Package Architecture Notes](architecture-notes.md)
  - package 경계와 public API 원칙을 설명한다.
- [Package Terminology](terminology.md)
  - data contract, DTO, public API, domain model 같은 공통 용어를 정의한다.

## 업데이트 원칙

이 디렉터리의 문서는 사람이 현재 결정을 빠르게 이해하기 위한 문서다. 도메인 결정이 바뀌면 새 결정을 별도 파일에만 누적하지 말고, 관련 문서 본문도 함께 최신화한다.
