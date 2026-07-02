# realtime-chat-gateway 앱

## 목적

실시간 채팅 WebSocket gateway를 실행하는 배포 가능한 앱 셸이다.

이 앱은 클라이언트 WebSocket 연결을 유지하고, package public API가 제공하는 gateway runtime을 mount한다.

## 책임 경계

gateway는 연결 관문이다. 비즈니스 서버가 아니라 socket delivery node다.

허용되는 책임:

- WebSocket server 실행
- presigned ticket 기반 handshake 진입점 연결
- package gateway runtime mount
- local connection/session map을 package adapter 뒤에서 사용
- inbound frame을 package runtime으로 넘김
- outbound broker event를 package runtime으로 넘김
- health/readiness/version endpoint 제공
- graceful shutdown

금지되는 책임:

- room membership rule 직접 판단
- message authorization 직접 판단
- message persistence 직접 수행
- profanity, moderation, business validation 직접 수행
- Redis/Kafka/DB provider 직접 호출
- product socket event contract를 app 안에서 정의

## 기본 흐름

```txt
client
  -> realtime-chat-api: login or presigned ticket issue
  -> realtime-chat-gateway: WebSocket handshake with ticket
  -> package gateway runtime: bind connection session
```

Inbound:

```txt
client socket
  -> realtime-chat-gateway
  -> package gateway runtime
  -> inbound command port
  -> realtime-chat-api or message service
```

Outbound:

```txt
realtime-chat-api or message service
  -> outbound event bus port
  -> package gateway runtime
  -> local session lookup
  -> recipient socket send
```

## 1차 구현 기준

1차 구현에서는 Redis 같은 외부 broker를 직접 붙이지 않는다.

package 경계에 port를 먼저 정의하고, 기본 adapter는 in-memory/mock 구현으로 둔다. 이후 Redis Pub/Sub, Kafka, durable stream, shared presence registry가 필요해지면 app shell을 바꾸지 않고 package adapter만 교체한다.
