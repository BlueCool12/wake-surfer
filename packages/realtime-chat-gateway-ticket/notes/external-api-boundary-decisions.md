# gateway-ticket 외부 API 경계 결정 기록

## 문서 목적

이 문서는 `gateway-ticket` 공개 API를 가다듬으면서 정리한 경계 판단을 기록한다.

현재 계약의 원천은 `README.md`와 `@wake-surfer/realtime-chat-gateway-ticket-contracts`다. 이 문서는
계약 문서가 아니라, 왜 `actorId`와 `gatewayId`를 요청 body에서 받지 않도록 정리했는지 설명하는 사람용
notes 문서다.

## 문제의 핵심

`gateway-ticket` 유스케이스에는 `actorId`와 `gatewayId`가 모두 필요하다.

하지만 "필요한 값"이라는 사실과 "클라이언트에게 받는 값"이라는 사실은 다르다. 이번 API 정리의 핵심은
이 둘을 분리하는 것이었다.

```txt
필요한 값
  actorId
  gatewayId
  ticket

클라이언트가 직접 제시해도 되는 값
  ticket

서버가 신뢰 가능한 컨텍스트에서 확정해야 하는 값
  actorId
  gatewayId
```

## actorId 경계

티켓 발급에는 `actorId`가 필요하다. 발급된 티켓이 어느 실시간 연결 주체에게 속하는지 저장해야 하고,
나중에 티켓 소비가 성공하면 Gateway가 이 값을 기준으로 세션을 열 수 있어야 한다.

다만 `actorId`는 클라이언트 request body에서 읽으면 안 된다.

클라이언트가 다음처럼 값을 보낼 수 있다고 가정하면, 사용자가 임의의 actor로 티켓을 발급받는 경로가
생긴다.

```json
{
  "actorId": "other-user"
}
```

그래서 `IssueGatewayTicketCommand`에는 `actorId`가 남아 있지만, 이 값은 API 서버가 인증 결과에서
만들어야 한다.

```ts
const principal = await authenticateJwt(request);

await gatewayTicket.issue({
  actorId: principal.subject,
});
```

즉 `actorId`는 유스케이스 입력으로는 맞지만, 외부 요청 body 계약은 아니다.

## actor라는 이름을 유지한 이유

현재는 `actorId`가 사용자 ID와 같을 수 있다. 그래도 `userId`로 고정하지 않았다.

실시간 연결 주체는 나중에 사용자뿐 아니라 봇, 시스템 주체, 서비스 계정이 될 수 있다. `actor`는
"실시간 연결을 통해 행동하는 주체"라는 의미라서 `gateway-ticket` 내부 표현으로 더 넓다.

인증 경계에서는 `principal.subject` 또는 `userId` 같은 인증 도메인의 이름을 사용하고, gateway-ticket
유스케이스로 넘길 때 `actorId`로 변환한다.

## gatewayId 경계

티켓 소비에는 `gatewayId`도 필요하다.

발급 시점에 티켓은 특정 Gateway에 배정된다. 소비 시점에는 다음 조건을 모두 만족해야 한다.

```txt
ticket_hash 일치
assigned_gateway_id 일치
아직 소비되지 않음
만료되지 않음
```

여기서 `assigned_gateway_id` 검사를 빼면, A Gateway용으로 발급된 티켓이 B Gateway에서 소비될 수 있다.
그래서 `gatewayId` 자체는 소비 유스케이스에 반드시 필요하다.

다만 `gatewayId`도 request body에서 받으면 안 된다. 클라이언트나 검증되지 않은 호출자가 다음처럼
주장하는 값을 그대로 믿으면, Gateway 배정 검사가 보안 경계가 아니라 단순 문자열 비교가 된다.

```json
{
  "ticket": "gt_...",
  "gatewayId": "gateway-1"
}
```

그래서 공개 소비 요청 계약은 `ticket`만 가진다.

```ts
export type ConsumeGatewayTicketRequest = {
  ticket: GatewayTicket;
};
```

`gatewayId`는 서버 간 인증, Gateway 런타임 설정, 내부 라우팅 컨텍스트처럼 신뢰 가능한 서버 컨텍스트에서
확정한 뒤 별도 context로 넘긴다.

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

즉 `gatewayId`는 유스케이스 입력으로는 맞지만, 외부 요청 body 계약은 아니다.

## contracts 패키지 기준

`@wake-surfer/realtime-chat-gateway-ticket-contracts`는 프론트엔드, API 서버, Gateway가 공유하는 외부
요청/응답 계약만 담는다.

이번 정리 후 기준은 다음과 같다.

- 클라이언트가 보내거나 받는 값이면 contracts에 둔다.
- 서버가 인증/인가/내부 라우팅으로 확정해야 하는 값이면 contracts 요청 body에 두지 않는다.
- 구현 패키지의 조립 API에서만 필요한 값이면 `@wake-surfer/realtime-chat-gateway-ticket` 쪽 타입으로 둔다.

이 기준 때문에 `ConsumeGatewayTicketRequest`에서는 `gatewayId`를 제거했고, `GatewayId` 타입도
contracts에서 구현 패키지로 옮겼다.

## 정리된 API 모양

발급은 인증 결과에서 `actorId`를 만들어 호출한다.

```ts
await gatewayTicket.issue({
  actorId: principal.subject,
});
```

소비는 요청 body의 `ticket`과 서버 컨텍스트의 `gatewayId`를 분리해서 호출한다.

```ts
await gatewayTicket.consume(
  {
    ticket: requestBody.ticket,
  },
  {
    gatewayId: authenticatedGateway.gatewayId,
  },
);
```

이 구조는 값이 필요한 위치와 값을 신뢰할 수 있는 위치를 분리한다. `gateway-ticket`은 티켓 발급/소비
규칙을 책임지고, API 앱은 인증된 actor와 Gateway 정체성을 확정하는 책임을 가진다.

## 피하려는 오해

`actorId`나 `gatewayId`를 제거한 것이 아니다. 두 값은 여전히 도메인 규칙에 필요하다.

제거한 것은 "클라이언트가 그 값을 request body로 주장할 수 있는 구조"다.

이 차이를 잃어버리면 다음 문제가 생긴다.

- 클라이언트가 다른 actor로 티켓을 발급받을 수 있다.
- 클라이언트나 검증되지 않은 Gateway가 임의의 gatewayId로 티켓 소비를 시도할 수 있다.
- contracts 패키지가 외부 계약이 아니라 서버 내부 조립 타입까지 담게 된다.
- feature 패키지의 공개 API가 인증 경계와 유스케이스 경계를 섞어 버린다.

따라서 앞으로 gateway-ticket API를 확장할 때도 "필요한 값인가"와 "외부 body로 받아도 되는 값인가"를
분리해서 판단한다.
