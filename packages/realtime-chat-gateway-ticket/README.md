# @wake-surfer/realtime-chat-gateway-ticket

실시간 채팅 게이트웨이에 접속하기 전에 사용하는 일회성 게이트웨이 티켓을 발급하고 소비하는 패키지다.

이 패키지는 `realtime-chat` 전체 기능을 담지 않는다. 책임은 게이트웨이 티켓 생명주기 하나로 제한한다.

## 책임

- 인증된 actor에게 게이트웨이 접속용 일회성 티켓을 발급한다.
- 티켓 원문은 클라이언트에게만 반환하고, 저장소에는 해시만 저장한다.
- 티켓에는 만료 시각과 할당된 게이트웨이를 기록한다.
- 게이트웨이가 제시한 티켓을 원자적으로 소비한다.
- 소비 실패 사유는 외부 계약에서 `invalid_or_expired`로 단순화한다.

## 책임이 아닌 것

- HTTP 라우팅과 Hono 앱 구성
- WebSocket 연결 수립과 세션 레지스트리
- Pino 로깅, 메트릭, 런타임 설정
- 인증/인가 정책 자체
- 게이트웨이 선택 전략의 소유
- 프론트엔드와 직접 공유되는 요청/응답 타입의 소유

프론트엔드와 백엔드가 함께 사용하는 요청/응답 타입은 별도 패키지인
`@wake-surfer/realtime-chat-gateway-ticket-contracts`가 소유한다.

## 구조

```txt
src/
  gateway-ticket.ts
  gateway-ticket-table.ts
  slices/
    issue-gateway-ticket/
      issue-gateway-ticket.usecase.ts
      issue-gateway-ticket.schema.ts
      issue-gateway-ticket.kysely.ts
    consume-gateway-ticket/
      consume-gateway-ticket.usecase.ts
      consume-gateway-ticket.schema.ts
      consume-gateway-ticket.kysely.ts
```

`gateway-ticket.ts`는 티켓 모델, 정책, 해시/생성 기본 구현을 담는다.

`gateway-ticket-table.ts`는 `gateway_tickets` 테이블 정의와 생성 SQL을 담는다.

각 slice는 요청 검증, 유스케이스, Kysely 저장소 함수를 함께 둔다. 이 패키지 내부에서는
`ports`, `adapters`, `persistence` 같은 레이어 디렉터리를 두지 않는다. 변경 이유는 게이트웨이 티켓
도메인 자체이며, 발급과 소비 slice가 그 하위 변경 단위다.

## 공개 API

주요 export는 다음과 같다.

- `issueGatewayTicket`
- `consumeGatewayTicket`
- `parseIssueGatewayTicketRequestBody`
- `parseConsumeGatewayTicketRequestBody`
- `saveIssuedGatewayTicketWithKysely`
- `consumeIssuedGatewayTicketWithKysely`
- `createGatewayTicketsTable`
- `createStaticGatewayAssigner`
- `defaultGatewayTicketPolicy`

## 발급 흐름

```ts
import {
  createStaticGatewayAssigner,
  issueGatewayTicket,
  saveIssuedGatewayTicketWithKysely,
} from "@wake-surfer/realtime-chat-gateway-ticket";

const response = await issueGatewayTicket(
  { actorId: "actor-1" },
  {
    now: () => new Date(),
    assignGateway: createStaticGatewayAssigner({
      gatewayId: "gateway-1",
      gatewayUrl: "wss://gateway.example.com/realtime-chat",
    }),
    saveIssuedGatewayTicket: saveIssuedGatewayTicketWithKysely(db),
  },
);
```

응답은 공용 계약 패키지의 `IssueGatewayTicketResponse` 형태다.

```ts
{
  ticket: "gt_...",
  gatewayUrl: "wss://gateway.example.com/realtime-chat",
  expiresAt: "2026-07-09T00:00:00.000Z"
}
```

## 소비 흐름

```ts
import {
  consumeGatewayTicket,
  consumeIssuedGatewayTicketWithKysely,
} from "@wake-surfer/realtime-chat-gateway-ticket";

const result = await consumeGatewayTicket(
  {
    ticket: "gt_...",
    gatewayId: "gateway-1",
  },
  {
    now: () => new Date(),
    consumeIssuedGatewayTicket: consumeIssuedGatewayTicketWithKysely(db),
  },
);
```

성공하면 actor와 소비 시각을 반환한다.

```ts
{
  status: "consumed",
  ticket: {
    actorId: "actor-1",
    consumedAt: "2026-07-09T00:00:00.000Z"
  }
}
```

티켓이 없거나, 만료됐거나, 이미 사용됐거나, 다른 게이트웨이에 할당된 경우는 모두 같은 외부 응답으로
접는다.

```ts
{
  status: "rejected",
  reason: "invalid_or_expired"
}
```

## 테이블

`createGatewayTicketsTable(db)`는 다음 테이블을 만든다.

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

소비는 `ticket_hash`, `assigned_gateway_id`, `consumed_at IS NULL`, `expires_at > now` 조건을 만족하는
행만 갱신한다. 이 때문에 같은 티켓은 한 번만 소비된다.

## 계약 패키지와의 관계

`@wake-surfer/realtime-chat-gateway-ticket-contracts`는 다음처럼 외부 경계에서 공유되는 타입만 가진다.

- `IssueGatewayTicketResponse`
- `ConsumeGatewayTicketRequest`
- `ConsumeGatewayTicketResponse`
- `GatewayTicket`
- `GatewayId`
- `ActorId`
- `ISODateTime`

이 구현 패키지는 계약 타입을 사용하지만, HTTP 응답 포맷이나 클라이언트 공유 타입을 새로 정의하지
않는다.
