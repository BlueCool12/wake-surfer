# realtime-chat 패키지

실시간 채팅의 도메인 규칙, gateway relay 계약, 메시지 저장 흐름을 앱 밖으로 가두는 패키지다.

## 현재 설계 기준

이 패키지 문서는 [도메인 이벤트 스토밍 결과](../../docs/realtime-chat/domain-event-storming-report.md)의 최종 결정을 사람이 읽기 쉽게 옮긴다.

핵심 결정은 다음과 같다.

| 영역 | 결정 |
| --- | --- |
| 메시지 정렬 | 전역 순번이 아니라 `streamId + sequence`를 사용한다. |
| 대화 단위 | Channel, DM, Thread는 모두 `ConversationStream`으로 다룬다. |
| 메시지 멱등성 | `senderId + streamId + clientMessageId` 재시도는 기존 메시지를 반환한다. |
| Gateway Ticket | MVP 배포 기준은 RDB 기반 one-time consume이다. in-memory ticket은 테스트/mock 전용이다. |
| Sender ACK | ACK는 저장과 sequence 발급 성공을 뜻한다. 모든 수신자의 realtime push 성공을 뜻하지 않는다. |
| 배달 실패 | DB 저장 후 outbound publish 실패는 MVP에서 허용하고 `afterSequence` sync로 복구한다. |

## 책임 경계

`realtime-chat-api`와 `realtime-chat-gateway`는 별도 배포 단위다. 이 패키지는 두 앱이 제품 세부를 몰라도 HTTP API와 WebSocket gateway를 연결할 수 있는 public API를 제공한다.

| Context | 이 패키지가 소유하는 것 | 이 패키지가 최종 판단하지 않는 것 |
| --- | --- | --- |
| Chat | 메시지 작성 workflow, stream sequence, read cursor, system message 정책 | Workspace 멤버 원천 데이터, 인증 원천 데이터 |
| Realtime Gateway | ticket consume 호출, local session registry, transport validation, socket push | 채팅 권한, 메시지 저장, sequence 발급 |
| Outbound Delivery | delivery event publish/subscribe 계약 | 모든 수신자에게 realtime push가 성공했다는 보장 |

## 앱에 제공할 표면

- HTTP API runtime 또는 route 생성 진입점
- WebSocket gateway runtime 또는 handler 생성 진입점
- 실행에 필요한 설정 타입
- 클라이언트, API, gateway가 공유해야 하는 채팅 contract
- workflow를 외부 provider 없이 검증할 수 있는 in-memory/mock adapter

## 주요 포트와 MVP 어댑터

| Port | MVP 기준 | 비고 |
| --- | --- | --- |
| `GatewayTicketPort` | RDB-backed adapter | raw ticket은 저장하지 않고 hash를 저장한다. consume은 한 번만 성공해야 한다. |
| `GatewaySessionRegistryPort` | local in-memory registry | gateway 한 대의 socket session만 안다. shared presence는 별도 확장이다. |
| `InboundMessagePort` | API/message service relay | gateway가 받은 client event를 domain 처리 경계로 넘긴다. |
| `OutboundEventBusPort` | in-memory/mock 또는 broker adapter | 단일 프로세스 검증은 in-memory 가능. 서버군 전파는 Redis/Kafka/NATS 등으로 교체한다. |
| `ConnectionSenderPort` | gateway app socket adapter | WebSocket 구현체 타입이 package public API로 새지 않게 한다. |

상세 구조와 다이어그램은 [Gateway Relay Architecture](docs/gateway-relay-architecture.md)와 [게이트웨이 중계 흐름](docs/gateway-relay-sequence.md)을 기준으로 한다.

## 공개 진입점 원칙

앱이 사용할 수 있는 함수와 타입은 패키지의 공개 진입점에서 내보낸다.

내부 모델, 내부 유틸리티, 외부 WebSocket 라이브러리 타입, DB row 타입은 앱으로 흘러가지 않게 한다.
