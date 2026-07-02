# 실시간 채팅 리서치 노트

## 목적

`realtime-chat`은 배포 가능한 실시간 채팅 앱 셸(app shell)을 실행하는 책임을 가진다.

이 문서는 실시간 통신 리서치(realtime communication research) 중 채팅(chat)에 해당하는 내용만 정리한다. 최종 아키텍처 결정 문서(ADR)가 아니며, 특정 transport를 결론으로 고정하지 않는다. 채팅 구현에 필요한 후보 통신 방식, 테스트 기준, 앱 책임 경계를 정리하는 것이 목적이다.

## 앱 책임 경계

`apps/realtime-chat/README.md` 기준으로 이 앱의 책임은 다음과 같다.

- 서버 런타임 시작(server runtime startup)
- 환경 구성(environment configuration)
- 런타임 구성(runtime configuration)
- 채팅 런타임 진입점 연결(connecting the chat runtime entry point)

이 앱은 채팅 도메인 규칙(chat domain rules)을 직접 소유하지 않는다. 다음 항목은 패키지 계층(package-level modules)의 책임으로 둔다.

- 방 모델(room model)
- 참여자와 세션 모델(participant/session model)
- 메시지 모델(message model)
- 재연결과 resume 규칙(reconnect/resume rules)
- protocol validation
- transport별 채팅 런타임 구현(transport-specific chat runtime implementation)

앱 문서에서는 실제 패키지 이름, 내부 파일 경로, 사용 라이브러리, 구현체를 미리 고정하지 않는다.

## 용어

- Transport: 이벤트를 실어 나르는 프로토콜 또는 API. 예: WebSocket, WebRTC DataChannel, SSE, HTTP long polling, WebTransport.
- Topology: 클라이언트와 서버가 연결되는 구조. 예: client-server relay, P2P direct, mesh, host relay, federation.
- Messaging pattern: 이벤트를 분배하는 방식. 예: request-response, room broadcast, pub/sub fanout, event streaming.
- Application protocol: 채팅 레벨의 이벤트 계약. 예: `room.join`, `chat.message`, `chat.ack`, `resume`.

## 채팅 범위

채팅 구현 범위는 다음 항목을 포함한다.

- 방 기반 채팅(room-based chat)
- 1:1 방
- 다자 방(multi-participant rooms)
- 방 입장과 퇴장(room join and leave)
- 메시지 전송과 broadcast(message send and broadcast)
- typing indicator
- presence update
- 연결 종료 처리(connection close handling)
- 재연결과 resume 동작(reconnect/resume behavior)
- 중복 메시지 처리(duplicate message handling)
- 메시지 순서 확인(message ordering checks)
- 기능 테스트(functional tests)
- benchmark 또는 load-test scaffold

채팅 구현 범위에서 제외하는 항목은 다음과 같다.

- SFU 또는 MCU 미디어 아키텍처
- 음성, 영상, 화면 공유 transport
- 완성형 협업 편집 아키텍처
- WebRTC 미디어 방 설계
- federation 제품 전략
- 완성형 채팅 UI
- 고도화된 인증/권한 모델
- 고도화된 메시지 영구 저장 설계

## 후보 통신 방식

### WebSocket Client-Server Relay

개념: 각 클라이언트가 서버와 WebSocket 연결을 유지하고, 서버가 방 참여자 목록(room membership)을 기준으로 같은 방 참가자에게 채팅 이벤트를 broadcast한다.

적합한 항목:

- 기본 방 채팅(baseline room chat)
- 1:1 채팅
- 다자 채팅
- presence와 typing 이벤트
- 재연결과 resume 처리
- 서버 기준 ordering, rate limit, validation

주요 리스크:

- stateful connection 운영이 필요하다.
- 서버 egress가 room fanout 수에 비례해 증가한다.
- multi-node 확장에는 connection registry, broker, event log가 필요하다.

테스트 초점:

- 같은 방 참가자에게만 broadcast되는지
- 다른 방으로 이벤트가 새지 않는지(cross-room isolation)
- `clientMsgId` 기준 중복 메시지가 억제되는지(duplicate suppression)
- 방 단위 sequence ordering이 유지되는지
- 마지막 수신 sequence 기준으로 재연결 복구가 가능한지
- 빠른 입장/퇴장(rapid join/leave) 상황에서 상태가 깨지지 않는지

### WebSocket + Pub/Sub Fanout

개념: WebSocket gateway는 클라이언트 연결을 유지하고, broker 또는 stream이 여러 gateway 사이에서 room event를 fanout한다.

적합한 항목:

- multi-node 채팅 확장
- hot room fanout 실험
- durable stream과 결합한 replay/resume 실험

주요 리스크:

- broker 운영과 장애 처리가 필요하다.
- 순수 pub/sub는 subscriber가 끊긴 동안 이벤트를 잃을 수 있다.
- ordering 규칙을 명확히 정의해야 한다.

테스트 초점:

- gateway 간 room fanout
- broker 연결 종료와 복구
- 재연결 후 event replay
- 중복 이벤트와 out-of-order 이벤트 처리

### Socket.IO / Engine.IO 계열

개념: handshake, fallback, upgrade, adapter를 포함하는 realtime transport 추상화 계열이다.

적합한 항목:

- 빠른 prototype
- polling에서 WebSocket으로 upgrade되는 경로 테스트
- 내장 room/recovery 기능 검증

주요 리스크:

- protocol과 runtime 동작이 framework에 묶인다.
- delivery와 recovery 보장은 별도로 검증해야 한다.
- adapter 보안과 broker 설정을 따로 검토해야 한다.

테스트 초점:

- transport upgrade 경로
- room broadcast 동작
- recovery 동작
- multi-node adapter 동작

### WebRTC DataChannel Direct P2P

개념: signaling 경로로 두 peer를 연결한 뒤, 실제 채팅 데이터는 WebRTC DataChannel로 peer 간 직접 전송한다.

적합한 항목:

- 1:1 direct chat 비교
- latency와 server bandwidth 실험
- NAT/TURN 성공률 측정

주요 리스크:

- NAT traversal과 TURN fallback이 필요하다.
- moderation, audit, replay, persistence가 어려워진다.
- durable room chat의 기본 구조로는 자연스럽지 않다.

테스트 초점:

- 연결 성공률(connection setup success rate)
- direct 경로와 TURN relay 경로의 latency 차이
- 재연결 동작
- 서버 bandwidth 감소량

### WebRTC DataChannel Mesh

개념: 방 안의 모든 참가자가 서로 WebRTC DataChannel 연결을 맺는다.

적합한 항목:

- 소규모 방 비교
- mesh 구조의 한계 지점 측정

주요 리스크:

- 참가자 수가 늘수록 연결 수가 빠르게 증가한다.
- 클라이언트 CPU, memory, uplink 부하가 증가한다.
- 방 참여자 변경 시 negotiation 복잡도가 커진다.

테스트 초점:

- 3명, 5명, 10명 방에서의 동작
- 연결 완료 시간(connection setup time)
- 클라이언트 부하(client load)
- 메시지 중복과 ordering

### Host Relay

개념: 한 참가자, 보통 host가 방의 hub 역할을 하고 다른 참가자의 메시지를 중계한다.

적합한 항목:

- host 중심 세션 실험
- server relay, mesh 구조와의 비교

주요 리스크:

- host가 단일 장애 지점(single point of failure)이 된다.
- host 네트워크 품질이 방 전체 품질을 결정한다.
- host migration과 audit가 어렵다.

테스트 초점:

- host 연결 종료
- host 네트워크 품질 저하
- host migration 또는 fallback 동작
- guest 간 메시지가 host를 통해 전달되는지

### SSE + REST Send

개념: 서버는 Server-Sent Events로 이벤트를 보내고, 클라이언트는 일반 HTTP 요청으로 메시지를 전송한다.

적합한 항목:

- 읽기 중심 feed-style chat fallback
- 제한된 네트워크 환경 비교
- 단순 receive stream 실험

주요 리스크:

- SSE는 기본적으로 서버에서 클라이언트로만 흐른다.
- send path와 receive path가 분리된다.
- 고빈도 양방향 채팅에는 적합하지 않다.

테스트 초점:

- receive stream 재연결
- `Last-Event-ID` 또는 유사 cursor 기반 resume
- REST send 후 streamed broadcast까지의 latency

### HTTP Long Polling

개념: 클라이언트가 이벤트 요청을 보내고, 서버는 이벤트가 생기거나 timeout이 날 때까지 응답을 지연한다. 응답 후 클라이언트는 다시 요청한다.

적합한 항목:

- fallback 동작
- 제한된 네트워크 환경 테스트

주요 리스크:

- request churn이 크다.
- persistent connection보다 latency와 overhead가 커질 수 있다.
- duplicate request와 in-flight request ordering 문제가 생길 수 있다.

테스트 초점:

- timeout 설정
- 재요청 loop 동작
- 중복 메시지 억제
- burst traffic 상황에서의 latency

### WebTransport

개념: HTTP/3 위에서 reliable stream과 unreliable datagram을 사용할 수 있는 browser-server transport다.

적합한 항목:

- 향후 chat/state-sync 비교
- 고빈도 ephemeral event 실험

주요 리스크:

- HTTP/3, QUIC 인프라 복잡도가 있다.
- browser, proxy, network 호환성을 검증해야 한다.
- fallback 설계가 필요하다.

테스트 초점:

- 연결 시작과 fallback
- reliable stream 동작
- typing/presence에 lossy event를 사용할 경우 손실 허용 동작

## 공통 채팅 이벤트 Envelope

후보 구현을 비교하려면 transport가 달라도 같은 application-level event shape을 사용해야 한다. 실제 package API는 별도 계층에서 결정하되, 개념적으로는 다음 필드를 유지한다.

```ts
type RealtimeChatEvent = {
  v: 1;
  type:
    | "room.join"
    | "room.leave"
    | "chat.message"
    | "chat.ack"
    | "presence.update"
    | "typing.start"
    | "typing.stop"
    | "resume"
    | "error";
  eventId: string;
  roomId: string;
  senderId: string;
  sessionId: string;
  clientMsgId?: string;
  serverSeq?: number;
  sentAt: number;
  payload: unknown;
};
```

설계 메모:

- `clientMsgId`는 idempotency와 duplicate suppression에 사용한다.
- `serverSeq`는 방 단위 ordering과 resume에 사용한다.
- `sessionId`는 사용자 identity와 단일 connection session을 분리한다.
- `payload`는 이벤트 타입별로 패키지 계층에서 검증한다.

## 기능 테스트 대상

- 방 생성 또는 입장
- 방 퇴장
- 메시지 전송
- 같은 방 참가자에게만 broadcast
- 다른 방에는 broadcast되지 않음
- 1:1 방 처리
- 다자 방 처리
- 연결 종료 시 participant state 정리
- 같은 `clientMsgId`를 가진 중복 메시지 억제
- `serverSeq` 기준 방 메시지 순서 보장
- typing과 presence 이벤트 전송
- 지원하는 경우 재연결 후 누락 이벤트 요청
- 잘못된 이벤트에 대한 구조화된 error 반환

## Benchmark 및 부하 테스트 대상

최소 시나리오:

- 1:1 채팅
- 3명 방
- 10명 방
- 30명 방
- burst message
- rapid join/leave
- client reconnect

확장 시나리오:

- 100명 방
- slow consumer
- large payload rejection
- gateway restart
- pub/sub가 있는 경우 broker restart
- 제한된 네트워크 fallback

측정 항목:

- latency p50, p95, p99
- throughput
- server CPU와 memory
- server ingress와 egress
- client memory
- reconnect time
- dropped message count
- duplicate message count
- out-of-order message count

## 외부 레퍼런스 범주

다음 레퍼런스는 이 앱의 직접 구현 요구사항이 아니라, 채팅 구조를 비교할 때 참고할 범주로만 둔다.

- Discord-style gateway: WebSocket event gateway, room/channel event delivery, media path 분리.
- Slack-style channel fanout: persistent connection, channel membership, gateway와 fanout 분리.
- Mattermost-style realtime chat: WebSocket 기반 채팅과 cluster 고려사항.
- Socket.IO: room, transport fallback, adapter, recovery 기능.
- Matrix-style federation: 장기 protocol 확장성 관점에서만 참고.

LiveKit, mediasoup, Janus, Google Meet, Zoom, SFU, MCU 같은 media-oriented reference는 미디어 리서치 범위에 가깝다. 이 앱의 채팅 구현 기준을 결정하는 근거로 사용하지 않는다.

## 작업 원칙

이 앱에서는 app shell을 작게 유지하고, protocol과 domain behavior는 패키지 계층이 소유하도록 둔다.

비교해야 할 대상은 "어떤 서비스 아키텍처가 가장 좋은가"가 아니라, 같은 채팅 protocol이 각 후보 transport 위에서 얼마나 정확하고 측정 가능하게 동작하는가이다.
