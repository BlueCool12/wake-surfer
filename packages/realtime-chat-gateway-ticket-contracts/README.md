# @wake-surfer/realtime-chat-gateway-ticket-contracts

게이트웨이 티켓 기능에서 프론트엔드와 백엔드가 함께 참조하는 외부 계약 패키지다.

이 패키지는 요청/응답 타입과 그 타입에 대응하는 validation schema를 함께 제공한다. 저장소 로직,
HTTP 라우팅, 도메인 유스케이스 구현은 이 패키지의 책임이 아니다.

## feature별 contracts로 나누는 이유

`realtime-chat` 전체에 하나의 contracts 패키지만 둘 수도 있다. 하지만 이 저장소에서는 유스케이스와
변경 이유를 기준으로 패키지를 나누기 위해 gateway-ticket 계약을 별도 패키지로 둔다.

메시지 전송, 읽음 처리, 세션 연결 같은 다른 기능은 각 기능의 contracts 패키지에서 다룬다. 이렇게 하면
consumer가 필요한 기능의 계약만 읽고 의존할 수 있고, gateway-ticket 변경이 realtime-chat 전체 계약
변경처럼 보이지 않는다. 앱은 필요한 feature contracts를 여러 개 조립해서 사용할 수 있다.

## 책임

- 게이트웨이 티켓 발급 응답 타입을 정의한다.
- 게이트웨이 티켓 소비 요청/응답 타입을 정의한다.
- 게이트웨이 티켓 요청 본문 validation schema를 정의한다.
- 외부 경계에서 노출되는 식별자와 시간 문자열 타입을 정의한다.
- 외부 응답에서 사용할 게이트웨이 티켓 거절 사유를 정의한다.

## 책임이 아닌 것

- 티켓 생성, 해시, 저장, 만료 계산
- Kysely 테이블 정의와 쿼리
- Hono 라우팅과 HTTP 응답 매핑
- WebSocket 게이트웨이 연결 처리
- 게이트웨이 선택 정책

구현은 `@wake-surfer/realtime-chat-gateway-ticket` 패키지가 담당한다.

## 공개 타입

```ts
export type ActorId = string;
export type GatewayTicket = string;
export type GatewayUrl = string;
export type ISODateTime = string;
```

현재 식별자는 primitive alias로 둔다. 외부 계약에서 이름을 고정해 두기 위한 타입이다. HTTP request
body처럼 wire format에 가까운 검증은 이 패키지의 schema가 맡고, 인증 컨텍스트나 도메인 invariant는
각 책임 패키지에서 별도로 검증한다.

## 발급 요청

```ts
export const IssueGatewayTicketRequestBodySchema = z.strictObject({});
export type IssueGatewayTicketRequest = z.infer<typeof IssueGatewayTicketRequestBodySchema>;
```

게이트웨이 티켓 발급 요청 body는 비어 있어야 한다. `actorId`, `userId`, `workspaceId` 같은 주체/권한
결정 값은 request body에서 받지 않고 API 서버의 인증 컨텍스트에서 확정한다.

## 발급 응답

```ts
export type IssueGatewayTicketResponse = {
  ticket: GatewayTicket;
  gatewayUrl: GatewayUrl;
  expiresAt: ISODateTime;
};
```

`ticket`은 클라이언트가 게이트웨이에 제시할 일회성 원문 티켓이다. 구현 패키지는 이 값을 그대로
저장하지 않고 해시만 저장한다.

`gatewayUrl`은 클라이언트가 접속할 게이트웨이 주소다.

`expiresAt`은 티켓 만료 시각이다.

## 소비 요청

```ts
export const ConsumeGatewayTicketRequestBodySchema = z.strictObject({
  ticket: z.string().trim().min(1),
});

export type ConsumeGatewayTicketRequest = {
  ticket: GatewayTicket;
};
```

게이트웨이는 클라이언트가 제시한 `ticket`으로 티켓 소비를 요청한다.

`gatewayId`는 요청 body에 싣지 않는다. API 서버는 서버 간 인증, 게이트웨이 설정, 내부 라우팅
컨텍스트처럼 신뢰 가능한 서버 컨텍스트에서 요청한 게이트웨이의 정체성을 확정해야 한다. 소비는 그
확정된 게이트웨이가 티켓에 할당된 게이트웨이와 같을 때만 성공해야 한다.

따라서 `GatewayId`는 프론트엔드와 공유되는 요청/응답 계약 타입이 아니라 구현 패키지의 서버 조립
API 타입이다.

## 소비 응답

```ts
export type ConsumeGatewayTicketResponse =
  | {
      status: "consumed";
      ticket: {
        actorId: ActorId;
        consumedAt: ISODateTime;
      };
    }
  | {
      status: "rejected";
      reason: "invalid_or_expired";
    };
```

성공하면 게이트웨이가 세션을 열 수 있도록 `actorId`와 소비 시각을 반환한다.

실패하면 세부 원인을 외부에 노출하지 않고 `invalid_or_expired` 하나로 접는다. 티켓 부재, 만료, 재사용,
게이트웨이 불일치는 모두 같은 외부 응답이다.

## 에러 코드

```ts
export type RealtimeChatErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "gateway_ticket_rejected"
  | "gateway_ticket_unavailable";
```

HTTP 앱이나 외부 API 레이어가 오류 응답을 구성할 때 사용할 수 있는 코드다. 이 패키지는 오류 응답
형태를 강제하지 않고 코드 집합만 제공한다.

## 요청 본문 검증

contracts 소비자는 schema를 사용해 요청 본문을 검증한다.

```ts
const parsed = ConsumeGatewayTicketRequestBodySchema.safeParse(body);
```

이 패키지는 요청 본문의 유효한 모양만 정의한다. 본문 부재 처리, validation 실패 메시지, HTTP status
code 매핑은 각 API 앱이 자기 라우트 흐름에 맞게 결정한다.

## 변경 기준

이 패키지는 외부 계약이 바뀔 때만 변경한다.

- 요청/응답 필드 추가 또는 제거
- 요청 본문 validation schema 변경
- 외부에 노출되는 상태값 변경
- 프론트엔드와 백엔드가 함께 참조해야 하는 식별자 타입 추가

구현 상세가 바뀌는 경우에는 이 패키지를 변경하지 않는다.
