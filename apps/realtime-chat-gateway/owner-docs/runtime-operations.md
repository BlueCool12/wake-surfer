# realtime-chat gateway 런타임 운영 설계

## 구현 원칙

- `createRealtimeChatGatewayApp()` 팩터리가 런타임 상태를 클로저로 소유한다.
- upgrade 검사, ticket 추출, 인증, heartbeat, HTTP 응답, 종료는 작은 함수로 분리한다.
- 서비스와 연결 객체를 감싸는 애플리케이션 클래스를 만들지 않는다.
- 프레임워크 객체인 Node `Server`, `WebSocketServer`, `WebSocket`은 경계 자원으로만 다룬다.
- 변경 가능한 `Map`과 `Set`은 런타임 팩터리 밖으로 노출하지 않고 count 조회 함수만 공개한다.

## 런타임 조립 경계

- `app.ts`는 HTTP/WebSocket 서버, 명시적 연결 상태, 하위 생명주기 함수를 조립한다.
- `config/env.ts`는 환경 변수를 파싱하고 값과 관계를 검증할 뿐 기본값을 채우지 않는다.
- 운영자가 선택하는 host, port, Origin, 용량, timeout, heartbeat, 종료 유예는 모두 필수 환경
  변수다. 누락 또는 오류는 서버 listen 전에 시작 실패로 처리한다.
- 내부 팀, 외부 시연, 고객 운영 프로필은 코드 분기가 아니라 배포 환경 변수 집합으로 구분한다.
- 프로필에 따라 달라지지 않는 WebSocket 수신 message payload 상한 `65,536바이트`는
  `config/runtime-policy.ts`의 코드 상수로 소유한다. `ws`는 fragmented frame을 재조립한 message
  전체 크기에 이 값을 적용한다.
- `connection/upgrade-policy.ts`는 upgrade 허용 여부만 판단한다.
- `app.ts`의 연결 경계는 ticket 소비 결과를 세션 등록 또는 close 부수 효과로 변환하고, 메시지·Stream
  Messages 흐름과 동일한 로컬 세션을 사용한다.
- `connection/heartbeat.ts`는 pong 대기 상태와 timer를 소유한다.
- `runtime/gateway-api-client.ts`는 ticket 소비와 메시지 전송 내부 HTTP 계약을 한 번만 정의한다.
- `runtime/close-servers.ts`는 WebSocket/HTTP 종료 결과를 합산한다.

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

Gateway의 outbound ticket API client timeout은 API operation deadline과 API Hono request
deadline보다 길어야 한다. API가 일회성 소비 결과나 timeout 응답을 확정하기 전에 Gateway가 먼저
timeout을 내면 성공 여부를 복구할 수 없기 때문이다. Gateway env parser는 API 설정을 읽지 않으므로
이 관계는 두 앱의 배포 설정 집합이 함께 책임진다.

Gateway의 Node HTTP timeout은 Gateway로 들어오는 health·upgrade HTTP 연결을 제한하는 별도 축이며,
outbound API client timeout과 중첩 시간 예산 관계가 아니다.

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

시작 로그에는 적용된 host·port·Origin, 연결·인증 대기 상한, heartbeat, inbound HTTP server timeout,
outbound API client timeout, 종료 유예, 고정 payload 상한과 내부 전송 보안 모드를 구조화해서
구분해 남긴다. token과 인증 헤더 값은 시작 로그에도 포함하지 않는다. 이 로그는 배포 프로필이
의도한 값으로 해석됐는지 확인하는 운영 증거다.

전체 연결 상한으로 upgrade를 거절하거나 인증 대기 상한으로 `1013` 종료할 때는 현재 count와 적용된
상한을 경고 로그에 남긴다. request URL과 ticket은 이 경고 로그에도 포함하지 않는다.

## 설정 검증

- env test의 완전한 fixture는 필요한 모든 변수를 열거한다.
- 각 변수를 하나씩 제거했을 때 `is required`로 실패하는지 검증해 새 fallback이 생기지 않게 한다.
- timeout 순서, 인증 대기 상한과 전체 연결 상한의 관계, production 전송 보안 조건을 함께 검증한다.
- `.env.example`은 `team-internal` 값의 명시적 예시이며 앱 parser의 fallback이나 고객 운영 권장값이
  아니다. 루트 `pnpm dev:realtime-chat` 실행기만 이 파일을 로컬 개발 배포 입력으로 명시적으로 읽는다.
- 알려진 개발 token과 `development` 신뢰 경계를 사용하는 예시는 loopback에만 bind한다. 다른
  인터페이스에 bind할 때는 실제 token, 접근 경계와 내부 전송 보안을 함께 바꾼다.

## 후속 작업

- 메시지 envelope schema와 protocol version 협상
- 송신 큐 상한과 `bufferedAmount` 기반 느린 consumer 제거
- 사용자·IP·gateway 단위 분산 rate limit
- 연결 수, 인증 실패, close code, heartbeat timeout metric
- 최종 gateway 서비스 인증
