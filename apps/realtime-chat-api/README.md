# realtime-chat-api 앱

## 목적

실시간 채팅의 HTTP API를 실행하는 배포 가능한 앱 셸이다.

구현 요구사항은 [이슈 #3](https://github.com/BlueCool12/wake-surfer/issues/3)을 따른다.

## 책임 경계

이 앱은 서버 실행, 환경 구성, 런타임 구성, HTTP API 진입점 연결만 맡는다.

방, 참여자, 메시지, 재연결, 검증 규칙은 앱이 아니라 패키지 계층의 책임이다.

이 앱은 클라이언트 WebSocket 연결을 직접 유지하지 않는다. WebSocket 연결, connection session map, socket delivery는 별도 배포 단위인 `apps/realtime-chat-gateway`의 책임이다.

## 기저 모듈 연결

앱은 패키지 계층이 HTTP API runtime을 만들거나 route를 넘겨받을 수 있는 공개 진입점을 제공한다고 가정한다.

앱 문맥에서는 실제 패키지 이름, 내부 파일 경로, 사용 라이브러리, 구현체를 고정하지 않는다.

## 실행 흐름 초안

```txt
환경 변수 로드
  -> 서버 런타임 생성
  -> HTTP API 진입점 연결
```

## Gateway와의 관계

클라이언트는 WebSocket 연결 전에 이 앱 또는 인증 API를 통해 presigned ticket과 gateway endpoint를 받는다.

```txt
client -> HTTP API -> presigned gateway ticket + gateway endpoint
client -> realtime-chat-gateway -> WebSocket handshake
```

HTTP API는 발급과 비즈니스 처리의 composition root일 뿐, 연결 유지 상태를 메모리에 저장하지 않는다.

상세 결정은 [Gateway Relay Architecture](../../packages/realtime-chat/docs/gateway-relay-architecture.md)를 기준으로 한다.
