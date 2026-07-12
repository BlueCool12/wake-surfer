# realtime-chat gateway 런타임 운영 설계

## 구현 원칙

- `createRealtimeChatGatewayApp()` 팩터리가 런타임 상태를 클로저로 소유한다.
- upgrade 검사, ticket 추출, 인증, heartbeat, HTTP 응답, 종료는 작은 함수로 분리한다.
- 서비스와 연결 객체를 감싸는 애플리케이션 클래스를 만들지 않는다.
- 프레임워크 객체인 Node `Server`, `WebSocketServer`, `WebSocket`은 경계 자원으로만 다룬다.
- 변경 가능한 `Map`과 `Set`은 런타임 팩터리 밖으로 노출하지 않고 count 조회 함수만 공개한다.

## 연결 생명주기

```text
HTTP upgrade
→ draining / path / Origin / 전체 연결 상한 검사
→ WebSocket 수락
→ 연결별 request ID 생성
→ 인증 대기 상한 검사
→ ticket consume 요청
→ accepted session 등록 또는 close
→ ping/pong heartbeat
→ close/error에서 모든 로컬 상태 제거
```

인증 중 클라이언트가 닫히면 `AbortController`로 ticket API 요청을 취소한다. API client가 취소를
무시하더라도 gateway의 시간 제한 경쟁 함수가 인증 대기 상태를 해제한다. 인증 결과가 늦게 도착해도
이미 닫힌 소켓은 세션에 등록하지 않는다.

## heartbeat

주기마다 이전 ping에 pong이 없던 연결은 `terminate()`한다. 새 ping을 보낸 연결은 다음 주기까지
`awaitingPong`에 유지하고, `pong` 또는 `close`에서 제거한다. heartbeat interval은 process 종료을
붙잡지 않도록 `unref()`한다.

## 종료

- 종료 시작과 동시에 draining 상태로 바꾸고 새 upgrade를 거절한다.
- heartbeat timer를 중지한다.
- 모든 client에 `1001` close를 보낸다.
- WebSocket과 HTTP server 종료를 함께 기다린다.
- 유예 시간이 지나면 남은 WebSocket은 `terminate()`하고 HTTP 연결은 강제로 닫는다.
- `close()`는 같은 Promise를 재사용해 멱등적으로 동작한다.

## 로그와 비밀값

연결 로그는 `requestId`, close code, actorId, gatewayId만 사용한다. ticket 원문, ticket query, 인증
헤더는 기록하지 않는다. reverse proxy 접근 로그에서도 gateway path의 query string을 가려야 한다.

## 후속 작업

- 메시지 envelope schema와 protocol version 협상
- 송신 큐 상한과 `bufferedAmount` 기반 느린 consumer 제거
- 사용자·IP·gateway 단위 분산 rate limit
- 연결 수, 인증 실패, close code, heartbeat timeout metric
- 최종 gateway 서비스 인증
