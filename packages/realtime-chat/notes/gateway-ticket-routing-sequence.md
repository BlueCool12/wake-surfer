# gateway ticket routing 시퀀스

## 상태

논의 메모입니다. 현재 구현을 이해하기 위한 파일/함수 단위 흐름이며, public contract가 아닙니다. 에이전트 작업 기준으로 사용하려면 필요한 내용을 `owner-docs/` 또는 `public-docs/`로 승격합니다.

## 티켓 발급 흐름

참여자 매핑:

| Participant      | TS file/function                                                                    |
| ---------------- | ----------------------------------------------------------------------------------- |
| `IssueHandler`   | `api/http/handlers/issue-gateway-ticket.handler.ts:createIssueGatewayTicketHandler` |
| `IssueSchema`    | `api/http/schemas/issue-gateway-ticket.schema.ts:parseIssueGatewayTicketRequest`    |
| `ActorContext`   | `api/http/actor-context.ts:extractActorId`                                          |
| `IssueUsecase`   | `api/usecases/issue-gateway-ticket.usecase.ts:issueGatewayTicket`                   |
| `PermissionPort` | `runtime-deps.ts:permissionPort.canIssueGatewayTicket`                              |
| `AssignmentPort` | `runtime-deps.ts:gatewayAssignmentPort.assignGatewayForTicket`                      |
| `TicketDomain`   | `api/domain/gateway-ticket.ts:issueGatewayTicketDomain`                             |
| `StoreMapper`    | `api/domain/gateway-ticket.ts:toStoredGatewayTicket`                                |
| `ApiDb`          | `runtime-deps.ts:db.issueGatewayTicket`                                             |
| `ResponseMapper` | `api/domain/gateway-ticket.ts:toIssueGatewayTicketResponse`                         |

```mermaid
sequenceDiagram
  autonumber
  participant Client
  participant IssueHandler
  participant IssueSchema
  participant ActorContext
  participant IssueUsecase
  participant PermissionPort
  participant AssignmentPort
  participant TicketDomain
  participant StoreMapper
  participant ApiDb
  participant ResponseMapper

  Client->>IssueHandler: gateway ticket 발급 요청
  IssueHandler->>IssueSchema: 요청 본문 파싱
  IssueSchema-->>IssueHandler: 발급 요청 DTO
  IssueHandler->>ActorContext: 인증 actor 추출
  alt 인증 actor 없음
    IssueHandler-->>Client: 401 UNAUTHENTICATED
  else 인증 actor 있음
    IssueHandler->>IssueUsecase: 티켓 발급 command
    IssueUsecase->>PermissionPort: actor 발급 권한 확인
    alt 발급 거부
      PermissionPort-->>IssueUsecase: 거부 결과
      IssueUsecase-->>IssueHandler: rejected 결과
      IssueHandler-->>Client: 403 rejected
    else 발급 허용
      PermissionPort-->>IssueUsecase: 허용 결과
      IssueUsecase->>AssignmentPort: actor에 대한 gateway 배정
      AssignmentPort-->>IssueUsecase: 배정된 gateway
      IssueUsecase->>TicketDomain: gateway ticket 도메인 값 발급
      TicketDomain-->>IssueUsecase: 발급된 gateway ticket
      IssueUsecase->>StoreMapper: 저장용 gateway ticket으로 변환
      StoreMapper-->>IssueUsecase: 저장용 gateway ticket
      IssueUsecase->>ApiDb: 저장용 gateway ticket 저장
      ApiDb-->>IssueUsecase: 저장 완료
      IssueUsecase->>ResponseMapper: 발급 응답으로 변환
      ResponseMapper-->>IssueUsecase: 발급 응답
      IssueUsecase-->>IssueHandler: issued 결과
      IssueHandler-->>Client: 201 발급 응답
    end
  end
```

## 티켓 소비와 gateway 접속 흐름

참여자 매핑:

| Participant         | TS file/function                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `ConnectionHandler` | `gateway/websocket/connection-handler.ts:createConnectionHandler`                                   |
| `ConnectUsecase`    | `gateway/usecases/connect-gateway-session.usecase.ts:connectGatewaySession`                         |
| `TicketConsumePort` | `gateway/runtime-deps.ts:gatewayTicketPort.consume`                                                 |
| `GatewayApiClient`  | `apps/realtime-chat-gateway/runtime/realtime-chat-api-client.ts:createHttpGatewayTicketConsumePort` |
| `ConsumeHandler`    | `api/http/handlers/consume-gateway-ticket.handler.ts:createConsumeGatewayTicketHandler`             |
| `ConsumeSchema`     | `api/http/schemas/consume-gateway-ticket.schema.ts:parseConsumeGatewayTicketRequest`                |
| `ConsumeUsecase`    | `api/usecases/consume-gateway-ticket.usecase.ts:consumeGatewayTicket`                               |
| `TicketHasher`      | `api/domain/gateway-ticket.ts:defaultTicketHasher.hash`                                             |
| `ApiDb`             | `runtime-deps.ts:db.consumeGatewayTicket`                                                           |
| `SessionRegistry`   | `gateway/session/in-memory-gateway-session-registry.ts:register`                                    |

```mermaid
sequenceDiagram
  autonumber
  participant Client
  participant ConnectionHandler
  participant ConnectUsecase
  participant TicketConsumePort
  participant GatewayApiClient
  participant ConsumeHandler
  participant ConsumeSchema
  participant ConsumeUsecase
  participant TicketHasher
  participant ApiDb
  participant SessionRegistry

  Client->>ConnectionHandler: ticket을 포함한 WebSocket 접속
  ConnectionHandler->>ConnectionHandler: ticket 추출
  alt ticket 없음
    ConnectionHandler-->>Client: 접속 거부 event
    ConnectionHandler-->>Client: 4401 ticket missing 종료
  else ticket 있음
    ConnectionHandler->>ConnectUsecase: gateway session 접속
    ConnectUsecase->>TicketConsumePort: 현재 gateway 기준 ticket 소비
    TicketConsumePort->>GatewayApiClient: consume endpoint 호출
    GatewayApiClient->>ConsumeHandler: internal consume 요청
    ConsumeHandler->>ConsumeSchema: 요청 본문 파싱
    ConsumeSchema-->>ConsumeHandler: 소비 요청 DTO
    ConsumeHandler->>ConsumeUsecase: gateway ticket 소비 command
    ConsumeUsecase->>TicketHasher: raw ticket hash
    TicketHasher-->>ConsumeUsecase: ticket value hash
    ConsumeUsecase->>ApiDb: hash, gateway id, 시각으로 소비
    alt 소비 거부
      ApiDb-->>ConsumeUsecase: rejected 결과
      ConsumeUsecase-->>ConsumeHandler: rejected 결과
      ConsumeHandler-->>GatewayApiClient: rejected 응답
      GatewayApiClient-->>TicketConsumePort: rejected 결과
      TicketConsumePort-->>ConnectUsecase: rejected 결과
      ConnectUsecase-->>ConnectionHandler: rejected 결과
      ConnectionHandler-->>Client: 접속 거부 event
      ConnectionHandler-->>Client: 4401 reason 종료
    else 소비 성공
      ApiDb-->>ConsumeUsecase: 소비된 actor
      ConsumeUsecase-->>ConsumeHandler: consumed 결과
      ConsumeHandler-->>GatewayApiClient: consumed 응답
      GatewayApiClient-->>TicketConsumePort: consumed 결과
      TicketConsumePort-->>ConnectUsecase: consumed 결과
      ConnectUsecase->>SessionRegistry: gateway session 등록
      ConnectUsecase-->>ConnectionHandler: 접속된 session
      ConnectionHandler-->>Client: gateway connected event
    end
  end
```

## 구현상 경계

- `IssueGatewayTicketRequest`는 actor/workspace를 담지 않는다.
- `issue-gateway-ticket.handler.ts`가 authenticated actor context를 package-private command로 변환한다.
- `issue-gateway-ticket.usecase.ts`는 권한 확인, gateway 배정, domain 발급, 저장, 결과 반환만 조율한다.
- `gateway-ticket.ts`는 ticket value/hash/expiresAt/assigned gateway를 포함한 발급 값을 만든다.
- `db.consumeGatewayTicket`은 ticket hash, 현재 gateway id, 만료, 소비 여부를 트랜잭션 경계에서 검증한다.
- Gateway는 DB를 직접 보지 않고 `GatewayTicketConsumePort`를 통해 API internal endpoint를 호출한다.
