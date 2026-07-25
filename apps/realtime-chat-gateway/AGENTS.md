# Realtime Chat Gateway Agent Context

이 앱은 WebSocket 연결과 로컬 세션·채널 구독을 소유하는 얇은 런타임이다.

- 티켓 발급·소비 정책과 메시지 저장 판단은 API 및 기능 패키지가 소유한다.
- Stream Messages의 검증·오류 매핑은
  `@wake-surfer/realtime-chat-stream-messages-gateway` 공개 API를 사용한다.
- WebSocket wire는 JSON 객체 `{ "type": "<event>", ...payload }` 형식이다.
- 클라이언트가 보낸 actor, gateway identity는 신뢰하지 않는다.
- 세션 actor는 소비된 일회성 게이트웨이 티켓에서만 확정한다.
- 새 이벤트를 추가할 때는 README의 wire 계약과 app smoke test를 함께 갱신한다.
- container 계약과 환경 파일은 `docker/`가 소유하며 Dockerfile 안에서 project를 빌드하지 않는다.
