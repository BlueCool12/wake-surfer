# 게이트웨이 중계 흐름

> 이 문서는 realtime-chat의 최초 흐름 스케치다. 현재 구현 계약이 아니며 사람용 설계 이력으로만 사용한다.
> 현재 코드로 확인된 결정은 `docs/realtime-chat/owner-docs/implemented-decisions.md`를 따른다.

## 문서 연결

이 문서는 클라이언트, 웹소켓 게이트웨이 서버군, 메인 API 서버군, 메시지 브로커 사이의 흐름을 시각화한다.

## 전체 구성

```mermaid
flowchart LR
  Client["클라이언트"]
  ApiGroup["메인 API 서버군"]
  GatewayGroup["웹소켓 게이트웨이 서버군"]
  Broker["메시지 브로커\n(1차: 인메모리/mock 어댑터)"]

  Client -- "HTTP 인증 / 티켓 요청" --> ApiGroup
  ApiGroup -- "접속 티켓 + 게이트웨이 주소" --> Client
  Client -- "웹소켓 연결 요청 + 티켓" --> GatewayGroup
  GatewayGroup -- "클라이언트 이벤트 전달" --> ApiGroup
  ApiGroup -- "배달 이벤트 발행" --> Broker
  Broker -- "게이트웨이 서버군으로 전파" --> GatewayGroup
  GatewayGroup -- "소켓으로 전송" --> Client
```

## 메시지 전송 시퀀스

```mermaid
sequenceDiagram
  autonumber
  participant C as 철수 클라이언트
  participant API as 메인 API 서버군
  participant G1 as 게이트웨이-1
  participant B as 메시지 브로커
  participant G2 as 게이트웨이-2
  participant Y as 영희 클라이언트

  rect rgb(245, 247, 250)
    Note over C,API: 1. 첫 접속 및 접속 티켓 발급
    C->>API: HTTP 로그인 / 게이트웨이 티켓 요청
    API-->>C: 접속 티켓 + 배정된 게이트웨이 주소
    C->>G1: 웹소켓 연결 요청(티켓 포함)
    G1->>G1: 티켓 검증 / 소비
    G1->>G1: 로컬 세션 등록<br/>철수 -> socket_fd_99
    G1-->>C: 웹소켓 연결 완료
  end

  rect rgb(250, 248, 242)
    Note over C,API: 2. 클라이언트에서 서버로 들어오는 흐름
    C->>G1: chat.message("영희야 안녕?")
    G1->>G1: 전송 계층 수준 확인<br/>크기 / 파싱 / 세션
    G1->>API: 받은 이벤트를 처리 경계로 전달
    API->>API: 권한 확인 / 검증 / 저장 / 순번 부여
    API-->>G1: 처리 성공 / 송신자 응답 결과
  end

  rect rgb(243, 250, 246)
    Note over API,Y: 3. 서버에서 클라이언트로 나가는 배달 흐름
    API->>B: 배달 이벤트 발행<br/>수신자=영희
    B-->>G1: 배달 이벤트
    B-->>G2: 배달 이벤트
    G1->>G1: 로컬 세션 조회(영희)<br/>없음
    G2->>G2: 로컬 세션 조회(영희)<br/>영희 -> socket_fd_104
    G2->>Y: 소켓으로 전송<br/>chat.message("영희야 안녕?")
  end
```
