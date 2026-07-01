# 용어 정의

이 문서는 구현 문서에서 반복해서 사용할 용어의 의미를 고정한다.

## Data contract

API, socket, client, server 사이에 오가는 데이터의 계약이다.

다음을 포함한다.

- request DTO
- response DTO
- event payload
- error shape
- runtime schema

`data contract`는 코드 import 표면이 아니다. `index.ts`로 어떤 함수를 export하는지는 `public API` 또는 `public exports`로 표현한다.

## DTO

`DTO`는 data contract를 구성하는 구체적인 데이터 객체 타입이다.

예:

```ts
type SendMessageRequestDto = {
  roomId: string
  body: string
}
```

DTO는 데이터를 전달하기 위한 모양이다. 도메인 불변식, 상태 전이, 저장소 접근 로직을 담지 않는다.

## Data object type

`data object type`은 DTO보다 넓게 쓸 수 있는 표현이다.

다음처럼 특정 전송 계층에 강하게 묶이지 않은 데이터 타입까지 포함할 수 있다.

- command input
- query result
- event payload
- serialized value object

외부 경계를 넘는 타입이면 가능한 한 `data contract`에 속하는지 먼저 판단한다.

## Public API

`public API`는 package 또는 module이 외부 코드에 공개하는 코드 사용 표면이다.

예:

```ts
export { createRealtimeChatApi } from './api'
export type { RealtimeChatWorkflow } from './workflow'
```

외부 코드는 package 내부 파일을 직접 import하지 않고 public API만 사용한다.

## Public exports

`public exports`는 public API를 실제로 구성하는 export 목록이다.

보통 다음 두 곳으로 통제한다.

- `src/index.ts`
- `package.json`의 `exports`

`public exports`에 없는 내부 파일, 내부 타입, 내부 helper는 외부 모듈이 의존하면 안 된다.

## Internal implementation

`internal implementation`은 public exports로 공개하지 않은 내부 구현이다.

예:

- 내부 helper
- private mapper
- repository 구현체
- provider SDK 호출 세부
- framework adapter 내부 함수

내부 구현은 같은 module 안에서만 바뀔 수 있어야 한다. 외부 모듈이 내부 구현을 import하면 경계가 깨진다.

## Domain model

`domain model`은 제품 규칙, 상태, 불변식, 상태 전이를 표현하는 내부 모델이다.

DTO와 domain model은 같은 것이 아니다. API response나 socket event로 domain model을 그대로 내보내지 않는다. 필요한 경우 명시적인 mapping을 거쳐 DTO로 변환한다.

## Persistence model

`persistence model`은 DB row, ORM model, 저장소 문서처럼 저장 구조에 맞춘 모델이다.

persistence model은 DTO나 domain model과 같은 것이 아니다. 저장 구조를 외부 data contract로 직접 노출하지 않는다.

## Schema

`schema`는 data contract를 런타임에서 검증하거나 직렬화하기 위한 정의다.

예:

- Zod schema
- JSON Schema
- OpenAPI schema
- socket event payload schema

schema는 data contract를 표현할 수 있지만, schema 도구 자체가 도메인 모델이 되면 안 된다.
