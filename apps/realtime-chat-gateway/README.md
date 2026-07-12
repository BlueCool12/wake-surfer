# realtime-chat-gateway app

외부에서 의존할 수 있는 WebSocket 연결, 종료 코드, 상태 확인과 운영 설정은
`apps/realtime-chat-gateway/public-docs/runtime-contract.md`에 정의한다.

`realtime-chat-gateway`는 실시간 채팅 WebSocket 게이트웨이 책임을 실행하는 배포 가능한 런타임 쉘이다.

이 앱은 런타임 조립만 소유한다.

- 환경 설정을 읽는다.
- 헬스 체크용 HTTP 서버를 연다.
- realtime chat 연결용 WebSocket 서버를 연다.
- WebSocket 요청에서 게이트웨이 티켓을 추출한다.
- `realtime-chat-api`에 게이트웨이 티켓 소비를 요청한다.
- 수락된 소켓의 로컬 인메모리 세션 소유권을 유지한다.
- 소켓 종료와 런타임 종료를 처리한다.

게이트웨이 티켓 규칙과 저장소 처리는 패키지와 API 서버가 소유한다.

## 엔드포인트

```txt
GET /health
GET /health/live
GET /health/ready
WS  /realtime-chat?ticket=...
```

WebSocket 티켓은 `ticket` 쿼리 파라미터 또는 `REALTIME_CHAT_GATEWAY_TICKET_HEADER`로 설정한 헤더로
전달할 수 있다. 브라우저 WebSocket API는 사용자 지정 헤더를 설정할 수 없으므로, 브라우저
클라이언트는 쿼리 파라미터를 사용한다.

게이트웨이는 다음 API를 호출해 티켓을 검증한다.

```txt
POST /internal/realtime-chat/gateway-tickets/consume
```

게이트웨이 identity는 `REALTIME_CHAT_API_GATEWAY_ID_HEADER`로 전달한다.

## 현재 범위

이 앱은 게이트웨이 티켓으로 WebSocket 세션을 수락하거나 거절하는 일만 처리한다. 메시지 라우팅,
outbound fan-out, presence, 재연결 의미론은 별도 계약과 패키지가 준비된 뒤 추가한다.

## 임시 결정과 후속 정리

현재 구현은 API 앱과 비슷한 런타임 쉘 구조를 먼저 맞추는 데 초점을 둔다. 세부 정책은 아직 확정하지
않는다.

나중에 별도 이슈에서 다시 맞출 항목은 다음과 같다.

- WebSocket close code와 reason 문구
- 연결 성공 시 클라이언트에 보낼 서버 이벤트 형태
- 로컬 세션 모델과 session id 생성 위치
- 메시지 수신, ACK, 재시도, 중복 처리 방식
- outbound fan-out과 Gateway 간 delivery 구조
- API 서버 장애와 티켓 거절을 클라이언트에 구분해 전달하는 방식
- 로그 필드, metric 이름, trace/request id 전달 방식

이 항목들은 게이트웨이 앱 안에서 먼저 고정하지 않는다. 관련 contracts와 gateway package 책임이 정리된
뒤 앱은 그 결정을 조립하는 쪽으로 얇게 유지한다.
