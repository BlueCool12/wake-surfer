# Stream Messages Gateway integration 내부 아키텍처

이 패키지는 전송 중립적인 `@wake-surfer/realtime-chat-stream-messages`의 consumer가 아니다. API가 공개한
versioned internal HTTP/WS 계약의 consumer이며, Gateway runtime port를 concrete protocol mapping에
연결한다.

`gateway-api-client.ts`는 Gateway에서 API로 향하는 HTTP credential, timeout, cancellation과 response
검증을 소유한다. `gateway-relay.ts`는 Gateway local session의 actor와 connection generation을 기준으로
WebSocket frame correlation과 stale response 폐기를 소유한다.

실제 server, socket, session registry, logger와 rate limiter 구현은 Gateway app이 주입한다. Gateway app이
저장소에 들어오면 이 패키지는 app의 public contract만 노출하는 provider로 유지하거나 app 내부로 흡수할
수 있다. 어느 경우에도 조회 코어 패키지가 이 패키지를 역으로 의존하지 않는다.
