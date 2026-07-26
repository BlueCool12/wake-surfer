# message-send transport boundary

## 배경

`message-send`는 본질적으로 메시지를 저장하는 API command다. WebSocket은 실시간 수신과 세션 이벤트에
강점이 있지만, 메시지 저장 command 자체는 HTTP로도 처리할 수 있다.

현재 구조에서 클라이언트가 WebSocket으로 메시지를 보내면 흐름은 다음과 같다.

```txt
Client
-> Gateway WebSocket
-> API HTTP
-> DB
-> Broker
-> Gateway
-> Client
```

반대로 클라이언트가 API로 직접 메시지를 보내면 command path는 한 단계 짧아진다.

```txt
Client
-> API HTTP
-> DB
-> Broker
-> Gateway
-> Client
```

## 판단

Gateway가 message-send command를 중계하는 방식은 클라이언트 채팅 이벤트 모델을 단순하게 만들 수
있지만, 성능 비용이 있다.

- Gateway가 socket event parsing과 API relay를 추가로 수행한다.
- Gateway -> API HTTP 호출 latency와 timeout 처리가 command path에 들어간다.
- Gateway 부하가 message send traffic에도 영향을 받는다.
- Gateway 장애가 실시간 수신뿐 아니라 메시지 전송에도 영향을 줄 수 있다.

따라서 `message-send` 구현은 특정 transport에 고정하지 않는다.

```txt
message-send = API command/usecase
HTTP route = 가능한 client write adapter
WebSocket event = 가능한 Gateway relay adapter
```

Gateway는 message-send의 도메인 판단, 저장, sequence, idempotency, recipient 계산을 소유하지 않는다.
Gateway가 WebSocket 입력을 받더라도 API command 경계로 전달하는 adapter 역할만 맡는다.

## 현재 결정

현재 구현은 `message-send`를 transport-agnostic package command로 둔다.

- HTTP API에서 직접 호출할 수 있어야 한다.
- Gateway WebSocket relay에서도 같은 command를 호출할 수 있어야 한다.
- 저장 성공인 `accepted`는 실시간 delivery 성공을 의미하지 않는다.
- delivery fan-out은 `outbound-delivery` 책임이다.

## 추후 결정 필요

- 클라이언트의 primary message send path를 HTTP로 둘지, WebSocket으로 둘지 결정
- Gateway -> API 호출에 timeout, retry, circuit breaker 정책을 둘지 결정
- HTTP send와 WebSocket send를 둘 다 제공할 경우 commandId/clientMessageId 응답 의미를 동일하게 유지할지 결정
- 성능 병목이 확인될 경우 Gateway relay 경로를 optional adapter로 낮출지 결정
