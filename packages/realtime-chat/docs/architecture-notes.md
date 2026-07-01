# Packages Architecture Notes

이 문서는 packages 구현 worker가 필요할 때 참고하는 상세 아키텍처 설명과 예시다.

용어는 [terminology.md](terminology.md)를 기준으로 한다.

## 핵심 원칙

package module은 공유 코드 창고가 아니라 제품 지식, 변화율, 소유권을 물리적으로 가두는 격자다.

```text
packages = 우리가 소유하는 기능/계약/규약/제품 지식의 물리적 격자
```

package module은 apps가 제품 세부를 몰라도 실행과 연결을 할 수 있도록 public API를 제공한다.

## Package 내부 경계

package module은 최소한 다음 성격의 경계를 가진다.

- `contract`: 프론트/백/socket/client가 공유하는 data contract
- `workflow`: 유스케이스, 애플리케이션 흐름, business operation
- `core`: 도메인 상태, 규칙, 불변식
- `persistence`: DB/ORM 접근과 저장 모델
- `api adapter`: HTTP/socket 같은 delivery framework와 workflow 연결

각 경계는 책임을 섞지 않는다.

```text
contract:
  request DTO, response DTO, event payload, error shape, schema

workflow:
  use case 실행 흐름, transaction boundary, port 조합

core:
  domain model, 상태 전이, 불변식

persistence:
  DB row, ORM model, repository 구현

api adapter:
  framework request를 data contract로 검증하고 workflow를 호출
```

## Apps와의 관계

apps는 package module의 public API 소비자다.

package는 apps가 다음을 몰라도 되게 해야 한다.

- DTO 필드 세부
- domain model
- persistence model
- repository 구현체
- provider SDK 호출 세부
- product별 에러 의미
- workflow 내부 순서

apps가 route를 mount해야 한다면 package는 mount 가능한 factory를 public API로 제공한다.

예:

```ts
export { createProductApi } from './api'
```

## Data Contract / DTO 규칙

DTO를 범용 shared type으로 만들지 않는다.

서로 다른 product/module은 `UserDto`, `SessionDto`, `MessageDto` 같은 하나의 공통 DTO를 import해서 같이 쓰지 않는다. DTO는 특정 product/module의 data contract에 속한다.

같은 data가 여러 product/module 경계를 지나야 한다면 DTO를 공유하지 말고 각 경계에 맞는 DTO를 따로 정의한 뒤 명시적으로 mapping/translation한다.

허용:

- 같은 product/module 안에서 client/server/socket이 공유해야 하는 data contract
- contract 경계에 위치한 request DTO, response DTO, event payload, error shape, schema
- product 내부 경계 사이에서 명시적인 mapping을 거친 DTO 변환

금지:

- `packages/common-dto`
- `packages/shared-types`에 product DTO 배치
- product A가 product B의 DTO를 자기 API response 타입으로 재사용
- DB row, ORM model, domain model을 DTO처럼 외부에 노출
- apps에 product request/response DTO 정의

## Mapping / Translation 규칙

경계를 넘을 때는 타입을 그대로 흘리지 말고 의미를 변환한다.

필요한 mapping:

- persistence model -> domain model
- domain model -> response DTO
- request DTO -> workflow command
- provider response -> product 내부 type
- product A data contract -> product B data contract

mapping은 변경 여파를 흡수하는 경계다. 중복을 줄이기 위해 공유 DTO를 만드는 방식으로 해결하지 않는다.

## Public API / Exports 규칙

package는 내부 구조를 숨기고 public API만 노출한다.

public API는 보통 다음 두 곳으로 통제한다.

- `src/index.ts`
- `package.json`의 `exports`

권장 예:

```json
{
  "name": "@repo/<product>",
  "exports": {
    ".": "./src/index.ts",
    "./contract": "./src/contract/index.ts"
  }
}
```

외부 모듈은 public exports에 없는 내부 파일을 import하면 안 된다.

금지:

```ts
import { ProductSession } from '@repo/<product>/src/core/session'
import { PrismaMessageRepository } from '@repo/<product>/src/persistence/prismaMessageRepository'
```

허용:

```ts
import { createProductApi } from '@repo/<product>'
import type { SendMessageRequestDto } from '@repo/<product>/contract'
```

## 외부 라이브러리 의존 규칙

외부 라이브러리를 쓴다고 항상 adapter를 만들지는 않는다.

판단 기준:

```text
이 라이브러리의 개념이 workflow/domain 언어를 오염시키는가?
이 라이브러리 사용에 운영 정책이 붙는가?
이 라이브러리가 외부 provider의 사업 계약을 들고 오는가?
이 라이브러리가 저장 구조를 들고 오는가?
이 라이브러리를 감싸면 wrapper가 라이브러리보다 복잡해지는가?
```

## 외부 의존성 배치 기준

운영 정책, 외부 provider 계약, persistence, 장애 처리, 보안 정책이 붙으면 package 경계 안에 둔다.

| 외부 의존성 | 권장 위치 | 이유 |
|---|---|---|
| `pino` | `base-logger` | requestId, traceId, redaction, error serialization |
| `fetch` / `undici` / `axios` | `base-http` | timeout, retry, trace, error normalization |
| `prisma` / `drizzle` | product persistence 경계 | 저장 모델과 도메인 모델 분리 |
| `stripe` / 결제 SDK | `platform-payment` | 외부 결제 상태, 실패 코드, 멱등성, provider 교체 |
| `openai` / LLM SDK | `platform-llm` 또는 product adapter | 모델/provider 변화율, 비용, 토큰, streaming 정책 |
| Redis | cache/rate-limit/presence package | TTL, 자료구조, 분산락, rate limit 의미 격리 |
| Kafka/SQS | `platform-event-bus` | delivery semantics, retry, idempotency |
| S3/GCS | `platform-object-storage` | bucket/key, upload policy, provider 격리 |
| SendGrid/Resend | `platform-notification` | template, unsubscribe, retry, provider 교체 |

## 일반화된 의존 규칙

```text
Runtime framework:
  delivery adapter에서 직접 사용 가능

Policy dependency:
  base package 뒤에 둔다

External provider dependency:
  platform adapter 또는 product adapter 뒤에 둔다

Persistence dependency:
  persistence 경계에 가둔다

Data contract/schema tool:
  contract 경계에서 직접 사용 가능

Pure utility:
  대체로 직접 사용 가능하지만 시간/ID처럼 테스트와 도메인 결정에 영향이 있으면 추상화한다
```

## 새 코드 위치 결정

```text
프론트/백/socket/client가 공유하는 data contract인가?
  -> contract 경계

HTTP request를 workflow로 연결하는 코드인가?
  -> api adapter

socket event를 workflow로 연결하는 코드인가?
  -> socket adapter

유스케이스 실행 흐름인가?
  -> workflow 경계

도메인 상태/규칙인가?
  -> core 경계

DB/ORM 접근인가?
  -> persistence 경계

여러 제품이 쓰는 조직 내부 능력인가?
  -> platform-* package 후보

도메인 무관하지만 우리 사용 규약인가?
  -> base-* package 후보

우리가 소유하지 않는 commodity 구현인가?
  -> node_modules 직접 사용 또는 adapter 뒤 사용 판단
```

## DTO 위치 결정

```text
특정 product/module의 API 계약인가?
  -> contract 경계

여러 product/module이 같이 쓰는 범용 DTO인가?
  -> 만들지 않는다. 각 경계의 data contract로 나누고 mapping한다.

health/version/readiness 같은 runtime 운영 응답인가?
  -> package module의 product data contract가 아니다.

DB row 또는 domain model인가?
  -> DTO로 직접 사용하지 않는다. mapping한다.
```

## 외부 의존성 판단 트리

```text
이 라이브러리 사용에 운영 정책이 붙는가?
  -> base wrapper 또는 platform adapter

외부 provider의 계약과 상태를 들고 오는가?
  -> platform adapter 또는 product adapter

저장소/ORM인가?
  -> persistence 경계

contract schema 도구인가?
  -> contract 경계에서 직접 사용 가능

감싸면 wrapper가 라이브러리보다 복잡해지는가?
  -> 감싸지 않는다. 단 domain/workflow 오염 여부는 다시 판단한다.
```

## Review Checklist

packages 변경을 볼 때 다음을 확인한다.

- product package가 다른 product 내부 모델을 직접 import하지 않는가?
- core/workflow가 Hono, React, Prisma, Stripe, OpenAI SDK를 직접 알지 않는가?
- persistence 경계 안에 ORM이 가둬져 있는가?
- platform/base 후보에 product 개념이 섞이지 않았는가?
- common/shared DTO가 추가되지 않았는가?
- DTO가 product/module의 data contract에 위치하는가?
- DB row/domain model을 response로 직접 내보내지 않는가?
- 필요한 mapping이 명시적으로 존재하는가?
- 외부 라이브러리를 무조건 감싸지 않았는가?
- provider/운영 정책 라이브러리가 apps로 새지 않는가?
- wrapper가 라이브러리보다 복잡해지지 않았는가?
- public exports에 없는 내부 파일을 외부에서 import하지 않는가?

## 구현 완료 시 보고 형식

packages 변경을 보고할 때 다음을 명시한다.

```text
변경한 packages:
추가/변경한 data contract:
추가/변경한 public API:
외부 dependency 직접 사용 여부:
adapter/wrapper를 만든 이유:
의도적으로 만들지 않은 adapter와 이유:
mapping/translation 추가 여부:
packages 경계 규칙 위반 가능성:
```


