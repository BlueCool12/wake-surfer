# @wake-surfer/realtime-chat-gateway-ticket-contracts

게이트웨이 티켓 기능에서 프론트엔드와 백엔드가 함께 참조하는 타입 계약 패키지다.

이 패키지는 구현을 담지 않는다. 런타임 의존성, 검증 로직, 저장소 로직, HTTP 라우팅은 모두 이 패키지의
책임이 아니다.

## 책임

- 게이트웨이 티켓 발급 응답 타입을 정의한다.
- 게이트웨이 티켓 소비 요청/응답 타입을 정의한다.
- 외부 경계에서 노출되는 식별자와 시간 문자열 타입을 정의한다.
- 외부 응답에서 사용할 게이트웨이 티켓 거절 사유를 정의한다.

## 책임이 아닌 것

- 티켓 생성, 해시, 저장, 만료 계산
- Zod 스키마와 요청 본문 검증
- Kysely 테이블 정의와 쿼리
- Hono 라우팅과 HTTP 응답 매핑
- WebSocket 게이트웨이 연결 처리
- 게이트웨이 선택 정책

구현은 `@wake-surfer/realtime-chat-gateway-ticket` 패키지가 담당한다.

## 공개 타입

```ts
export type ActorId = string;
export type GatewayId = string;
export type GatewayTicket = string;
export type GatewayUrl = string;
export type ISODateTime = string;
```

현재는 primitive alias로만 둔다. 외부 계약에서 이름을 고정해 두기 위한 타입이며, 값 검증은 구현
패키지나 앱 경계에서 수행한다.

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
export type ConsumeGatewayTicketRequest = {
  ticket: GatewayTicket;
  gatewayId: GatewayId;
};
```

게이트웨이는 클라이언트가 제시한 `ticket`과 자신의 `gatewayId`를 함께 보내 티켓 소비를 요청한다.
소비는 할당된 게이트웨이에서만 성공해야 한다.

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

## 변경 기준

이 패키지는 외부 계약이 바뀔 때만 변경한다.

- 요청/응답 필드 추가 또는 제거
- 외부에 노출되는 상태값 변경
- 프론트엔드와 백엔드가 함께 참조해야 하는 식별자 타입 추가

구현 상세가 바뀌는 경우에는 이 패키지를 변경하지 않는다.
