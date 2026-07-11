# @wake-surfer/api-contracts

프로젝트 전반의 API wire contract에서 반복해서 쓰는 공통 타입을 제공하는 패키지다.

이 패키지는 특정 feature 계약을 소유하지 않는다. gateway-ticket, message, session 같은 기능별 요청/응답
계약은 각 feature contracts 패키지가 소유하고, 이 패키지는 여러 기능에서 반복되는 아주 작은 공통
형태만 제공한다.

## 중요: 팀 설계 결정

이 패키지는 단순 타입 모음이 아니다.

`{ status: "error", code, message }` 형태의 에러 응답을 프로젝트 공통 API 계약으로 둘지 결정하는
지점이다. 이 결정은 API 앱, 프론트엔드, feature contracts, 테스트 코드에 반복적으로 영향을 준다.

리뷰어는 이 패키지를 추가하는 PR을 볼 때 다음을 반드시 확인해야 한다.

- 이 패키지가 프로젝트 공통 API contracts 역할을 가져도 되는가
- `ApiErrorResponse` 이름과 필드 모양이 장기적으로 적절한가
- 공통 에러 코드와 feature-specific 에러 코드를 어떻게 나눌 것인가
- feature contracts가 공통 에러 타입을 확장하는 방식이 적절한가
- 이 결정이 realtime-chat 외 다른 앱에도 적용 가능한가

에이전트로 이슈나 PR을 요약해서 읽는 경우에도, 위 항목은 사람 리뷰어에게 별도로 보고해야 한다.

## 책임

- 공통 API 에러 응답 envelope 타입을 제공한다.
- 여러 feature에서 공통으로 사용할 수 있는 최소 에러 코드 타입을 제공한다.
- feature-specific 에러 코드가 공통 envelope를 확장할 수 있는 타입 구조를 제공한다.

## 책임이 아닌 것

- feature별 요청/응답 타입 정의
- feature별 에러 코드 전체 목록 소유
- HTTP status code 매핑 정책
- Hono, React, WebSocket 같은 런타임 또는 프레임워크 의존 코드
- 로깅, 추적 ID, 메타데이터 응답 정책
- pagination, cursor, auth token 같은 다른 API 패턴 선점

## 공개 타입

```ts
export type ApiCommonErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "internal_error";

export type ApiErrorResponse<Code extends string = ApiCommonErrorCode> = {
  status: "error";
  code: Code;
  message: string;
};
```

`message`는 사람이 읽을 수 있는 설명이다. 클라이언트의 분기 기준은 `message`가 아니라 `code`여야 한다.

## feature contracts에서 확장하기

feature contracts는 공통 코드와 feature-specific 코드를 union으로 묶어서 `ApiErrorResponse`를 확장할 수
있다.

```ts
import type { ApiCommonErrorCode, ApiErrorResponse } from "@wake-surfer/api-contracts";

export type GatewayTicketErrorCode =
  | ApiCommonErrorCode
  | "gateway_ticket_rejected"
  | "gateway_ticket_unavailable";

export type GatewayTicketErrorResponse = ApiErrorResponse<GatewayTicketErrorCode>;
```

feature-specific 에러 코드는 이 패키지에 추가하지 않는다. 공통 패키지에는 여러 feature와 app에서 실제로
반복되는 코드만 올린다.

## 변경 기준

이 패키지는 여러 앱 또는 여러 feature contracts가 공유해야 하는 API wire contract가 생길 때만 변경한다.

단일 feature에서만 쓰는 타입은 해당 feature contracts 패키지에 둔다. 공통처럼 보이더라도 반복 사용이
확인되지 않은 타입을 먼저 이 패키지로 올리지 않는다.
