# Packages Worker Rules

이 문서는 현재 package module 구현 worker가 반드시 따르는 최소 규칙이다.

참조:

- 용어: [docs/terminology.md](docs/terminology.md)
- 상세 설명과 예시: [docs/architecture-notes.md](docs/architecture-notes.md)

## 역할

package module은 제품 지식, data contract, workflow, domain rule, persistence, 외부 provider 연동 세부를 가두는 경계다.

package module은 apps가 제품 세부를 몰라도 실행과 연결을 할 수 있도록 public API를 제공한다.

## MUST

- product data contract는 contract 경계에 둔다.
- 유스케이스 실행 흐름은 workflow 경계에 둔다.
- 도메인 상태, 규칙, 불변식은 core 경계에 둔다.
- DB/ORM 접근과 저장 모델은 persistence 경계에 둔다.
- HTTP/socket 같은 delivery framework와 workflow 연결은 adapter 경계에 둔다.
- 외부 모듈이 사용할 것은 public API와 public exports로만 노출한다.
- 경계를 넘는 데이터는 명시적으로 mapping/translation한다.
- provider SDK, 운영 정책 dependency, persistence dependency는 적절한 adapter 또는 내부 경계 뒤에 둔다.

## MUST NOT

- DTO를 범용 shared type으로 만들지 않는다.
- `packages/common-dto`나 `packages/shared-types`에 product DTO를 두지 않는다.
- 다른 product/module의 DTO를 자기 data contract처럼 import해서 재사용하지 않는다.
- DB row, ORM model, domain model을 API response나 socket payload로 직접 노출하지 않는다.
- core/workflow가 Hono, React, Prisma, Stripe, OpenAI SDK 같은 framework/provider 구현체를 직접 알게 하지 않는다.
- persistence 구현체나 내부 helper를 public exports 밖으로 새게 하지 않는다.
- package 내부 파일을 외부 모듈이 deep import하게 만들지 않는다.
- 중복 제거를 이유로 경계가 다른 DTO를 하나로 합치지 않는다.

## 판단 기준

새 코드가 data contract, workflow, domain rule, persistence, provider integration이면 package module 내부의 맞는 경계에 둔다.

새 코드가 apps의 실행, mount, wiring이면 package에 두지 않는다. 대신 apps가 사용할 public API를 제공한다.

새 타입이 여러 product/module에서 필요해 보여도 먼저 shared DTO가 아니라 각 경계의 data contract와 mapping으로 풀 수 있는지 판단한다.

## 완료 보고

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
