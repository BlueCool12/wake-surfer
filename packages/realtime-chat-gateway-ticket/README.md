# @wake-surfer/realtime-chat-gateway-ticket

실시간 채팅 게이트웨이에 접속하기 전에 사용하는 일회성 게이트웨이 티켓을 발급하고 소비하는 패키지다.

이 패키지는 `realtime-chat` 전체 기능을 담지 않는다. 책임은 게이트웨이 티켓 생명주기 하나로 제한한다.

## 책임

- 인증된 actor에게 게이트웨이 접속용 일회성 티켓을 발급한다.
- 티켓 원문은 클라이언트에게만 반환하고, 저장소에는 해시만 저장한다.
- 티켓에는 만료 시각과 할당된 게이트웨이를 기록한다.
- 게이트웨이가 제시한 티켓을 PostgreSQL에서 원자적으로 소비한다.
- 소비 실패 사유는 외부 계약에서 `invalid_or_expired`로 단순화한다.

## 책임이 아닌 것

- HTTP 라우팅과 Hono 앱 구성
- WebSocket 연결 수립과 세션 레지스트리
- Pino 로깅, 메트릭, 런타임 설정
- PostgreSQL 연결 풀 생성과 종료
- 인증/인가 정책 자체
- 게이트웨이 선택 전략의 소유
- 프론트엔드와 직접 공유되는 요청/응답 타입과 validation schema의 소유

프론트엔드와 백엔드가 함께 사용하는 요청/응답 타입과 validation schema는 별도 패키지인
`@wake-surfer/realtime-chat-gateway-ticket-contracts`가 소유한다.

## 구조

```txt
src/
  gateway-ticket-module.ts
  gateway-ticket.ts
  gateway-ticket-table.ts
  usecases/
    issue-gateway-ticket/
      issue-gateway-ticket.usecase.ts
      issue-gateway-ticket.kysely.ts
    consume-gateway-ticket/
      consume-gateway-ticket.usecase.ts
      consume-gateway-ticket.kysely.ts
```

`gateway-ticket-module.ts`는 공개 조립 API다. 컨슈머는 이 파일을 통해 모듈을 만들고, 내부 저장 구현은
알지 않는다.

`gateway-ticket.ts`는 티켓 모델, 내부 정책, 해시/생성 기본 구현을 담는다.

`gateway-ticket-table.ts`는 `gateway_tickets` 테이블 정의와 생성 SQL을 담는다.

각 usecase는 유스케이스와 Kysely 쿼리를 함께 둔다. 이 패키지 내부에서는 `ports`, `adapters`,
`persistence` 같은 레이어 디렉터리를 두지 않는다. 변경 이유는 게이트웨이 티켓 도메인 자체이며,
발급과 소비 usecase가 그 하위 변경 단위다.

## 공개 API

루트 공개 API는 다음으로 제한한다.

- `createGatewayTicketModule`
- `GatewayTicketModule`
- `CreateGatewayTicketModuleConfig`
- `ConsumeGatewayTicketContext`
- `GatewayId`
- `GatewayAssigner`
- `GatewayAssignment`
- `IssueGatewayTicketCommand`
- `createStaticGatewayAssigner`

요청/응답 계약 타입은 `@wake-surfer/realtime-chat-gateway-ticket-contracts`에서 가져온다.

## actorId 의미

`actorId`는 클라이언트가 보낸 요청 body에서 읽는 값이 아니다.

`actorId`는 JWT 검증 같은 인증 절차가 끝난 뒤 서버 컨텍스트에서 확정된 실시간 연결 주체 ID다. 현재는
사용자 ID와 같을 수 있지만, 나중에 봇, 시스템 주체, 서비스 계정 같은 연결 주체도 표현할 수 있도록
`userId` 대신 `actorId`라고 부른다.

따라서 API 앱은 다음처럼 클라이언트 입력이 아니라 인증 결과에서 command를 만들어야 한다.

```ts
const principal = await authenticateJwt(request);

await gatewayTicket.issue({
  actorId: principal.subject,
});
```

클라이언트가 보낸 `actorId`, `userId`, `workspaceId` 같은 주체/권한 결정 값으로 티켓을 발급하면 안
된다.

## gatewayId 의미

`gatewayId`는 티켓 소비 요청 body에서 읽는 값이 아니다.

티켓 소비는 게이트웨이가 클라이언트에게 받은 `ticket`을 API 서버에 검증받는 흐름이다. 이때 어느
게이트웨이가 소비를 요청했는지는 서버 간 인증, 게이트웨이 런타임 설정, 내부 라우팅 컨텍스트처럼
신뢰 가능한 서버 컨텍스트에서 확정해야 한다.

따라서 API 앱은 다음처럼 request와 gateway context를 분리해서 넘겨야 한다.

```ts
const authenticatedGateway = await authenticateGateway(request);

await gatewayTicket.consume(
  {
    ticket: requestBody.ticket,
  },
  {
    gatewayId: authenticatedGateway.gatewayId,
  },
);
```

클라이언트가 보낸 `gatewayId`나 검증되지 않은 게이트웨이 식별자 값으로 티켓을 소비하면 안 된다.

## 사용 예시

```ts
import { createRealtimeChatDatabase } from "@wake-surfer/realtime-chat-database";
import {
  createGatewayTicketModule,
  createStaticGatewayAssigner,
} from "@wake-surfer/realtime-chat-gateway-ticket";

const database = createRealtimeChatDatabase({
  databaseUrl: process.env.REALTIME_CHAT_DATABASE_URL,
});

const gatewayTicket = createGatewayTicketModule({
  db: database.db,
  assignGateway: createStaticGatewayAssigner({
    gatewayId: "gateway-1",
    gatewayUrl: "wss://gateway.example.com/realtime-chat",
  }),
  ticketTtlMilliseconds: 60_000,
  rawTicketBytes: 32,
});

const issued = await gatewayTicket.issue({
  actorId: "actor-1",
});

const consumed = await gatewayTicket.consume(
  {
    ticket: issued.ticket,
  },
  {
    gatewayId: "gateway-1",
  },
);

await database.close();
```

앱은 저장 함수를 만들거나 주입하지 않는다. 이 모듈은 전달받은 Kysely DB 핸들로 자기 쿼리를 실행한다.
PostgreSQL 연결 풀과 Kysely 인스턴스 생명주기는 `@wake-surfer/realtime-chat-database`가 소유한다.

## 정책

티켓 원문 바이트 수, TTL, 해시 방식, 일회성 소비 규칙은 이 패키지의 서버 런타임 정책이다. 앱이
호출마다 바꾸지 않는다.

`ticketTtlMilliseconds`와 `rawTicketBytes`는 `createGatewayTicketModule` 생성 시 반드시 넘긴다. `rawTicketBytes`는
16에서 64 사이의 정수여야 한다. 누락되거나 잘못된 값이면 모듈 생성 단계에서 예외가 발생해야 하며,
서버는 그 상태로 뜨면 안 된다.

## 서버군 동작

API 서버가 여러 대 떠도 모든 인스턴스가 같은 PostgreSQL의 `gateway_tickets` 테이블을 사용한다.

소비는 `ticket_hash`, `assigned_gateway_id`, `consumed_at IS NULL`, `expires_at > now` 조건을 만족하는
행만 갱신한다. 이 갱신은 단일 SQL 문으로 수행되므로 같은 티켓은 한 번만 소비된다.

## 테이블

`@wake-surfer/realtime-chat-database`가 소유한 Atlas versioned migration은 다음 테이블을 만든다.

```sql
CREATE TABLE IF NOT EXISTS gateway_tickets (
  ticket_hash text PRIMARY KEY,
  actor_id text NOT NULL,
  assigned_gateway_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL
);
```

이 패키지는 공통 DB 패키지가 전체 DB 타입을 합성할 수 있도록 `./table-contract` 서브패스로
`GatewayTicketDatabase` 타입을 제공한다. schema 생성 SQL과 적용 책임은 제공하지 않으며 일반 앱 코드는
이 서브패스를 직접 사용하지 않는다.

## 계약 패키지와의 관계

`@wake-surfer/realtime-chat-gateway-ticket-contracts`는 다음처럼 외부 경계에서 공유되는 타입과 request
body validation schema를 가진다.

- `IssueGatewayTicketResponse`
- `IssueGatewayTicketRequestBodySchema`
- `ConsumeGatewayTicketRequest`
- `ConsumeGatewayTicketResponse`
- `ConsumeGatewayTicketRequestBodySchema`
- `GatewayTicket`
- `ActorId`
- `ISODateTime`

이 구현 패키지는 계약 타입을 사용하지만, HTTP 요청 본문 schema, HTTP 응답 포맷, 클라이언트 공유 타입을
새로 정의하지 않는다. API 앱은 contracts schema를 사용해 요청을 검증하고 자기 라우트 흐름에 맞게
validation 실패를 응답으로 매핑한다.
