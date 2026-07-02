# Apps Architecture Notes

이 문서는 apps 구현 worker가 필요할 때 참고하는 상세 아키텍처 설명과 예시다.

용어는 [terminology.md](terminology.md)를 기준으로 한다.

## 핵심 원칙

apps module은 기능을 담는 곳이 아니라 실행 가능한 runtime shell이다.

```text
apps = deployable runtime shell
apps = composition root
apps = entrypoint
apps = terminal node
```

apps module은 독립적으로 실행되고 배포될 수 있어야 한다. 하지만 그 안에는 제품 규칙, 도메인 판단, data contract, 저장소 접근, 외부 provider 연동 세부가 들어가면 안 된다.

## MVP 변화율 격리 관점

apps module을 얇게 유지하는 이유는 product package가 항상 안정적인 핵심이라서가 아니다.

MVP 단계에서는 채팅 요구사항 자체가 가장 자주 바뀔 수 있다. `packages/realtime-chat`에 command, contract, workflow, adapter, domain rule을 모아두면 현재 채팅 구현을 잠시 사용하지 않거나 다른 구현으로 바꿀 때 변화가 package 경계 안에 머문다.

따라서 apps module은 채팅 제품 언어를 알아서는 안 된다. `JoinRoomCommand`, `SendMessageCommand`, `room.join`, `chat.message`, `resume` 같은 이름은 앱의 분기 조건이나 타입 정의로 새지 않아야 한다.

apps module이 고정하는 것은 프로세스, runtime framework, endpoint mount, shutdown 같은 낮은 변화율의 실행 셸이다.

## Apps가 해야 하는 일

apps module은 실행과 연결을 책임진다.

- 프로세스 부팅
- 런타임 프레임워크 선택
- 서버 실행
- React root 렌더링
- socket 서버 실행
- worker 실행
- 환경 변수 읽기
- node_modules 또는 package public factory를 통한 runtime logger 연결
- global middleware 연결
- auth middleware mount
- 제품별 API route mount
- health/readiness/version endpoint 제공
- graceful shutdown

## Apps가 하면 안 되는 일

apps module은 제품 의미를 판단하지 않는다.

- 도메인 불변식 구현
- 비즈니스 정책 구현
- 상태 전이 구현
- 유스케이스 구현
- product request/response DTO 정의
- product data contract 정의
- DB query
- repository 구현
- provider SDK 직접 호출
- 제품별 에러 의미 판단
- 권한 정책 세부 판단

## Apps는 얇아야 하지만, 더 중요하게는 무지해야 한다

나쁜 예:

```ts
if (session.status === 'closed') {
  return c.json({ error: 'SESSION_CLOSED' }, 400)
}
```

위 코드는 세션 상태와 제품 에러 의미를 apps가 판단한다.

좋은 예:

```ts
app.route('/v1/<product>', createProductApi())
```

위 코드는 제품 API를 연결할 뿐이다.

## API app 예시

```ts
const logger = createRuntimeLogger({ env })
const app = createBaseHonoApp({ logger })

installBaseMiddlewares(app)
installBaseErrorHandler(app)

app.use('/v1/<product>', requireIdentity)
app.route('/v1/<product>', createProductApi())

serve({ fetch: app.fetch, port })
```

이 코드에서 apps가 알아도 되는 것은 실행, middleware, route mount뿐이다.

apps module이 몰라야 하는 것:

- `SendMessageRequestDto`의 필드
- 세션 상태 전이
- 메시지 검증 규칙
- DB 저장 방식
- OpenAI/Stripe/S3 호출 방식
- product별 에러 코드 의미

logger의 경우 apps가 할 수 있는 일은 node_modules 또는 package가 제공하는 public factory를 호출해서 runtime logger instance를 만들고 주입하는 것이다. logger format, redaction, transport, trace 정책을 담은 구현 파일은 apps가 소유하지 않는다.

## Package Public API 사용 규칙

apps module은 package 내부 파일을 직접 import하지 않는다.

허용:

```ts
import { createProductApi } from '@repo/<product>'
```

금지:

```ts
import { createProductApi } from '@repo/<product>/src/api/createProductApi'
import { ProductSession } from '@repo/<product>/src/core/session'
```

apps는 package가 공개한 public API와 public exports만 사용한다.

## Data Contract / DTO 규칙

apps module은 product data contract를 소유하지 않는다.

금지:

- product request DTO 정의
- product response DTO 정의
- socket event payload 정의
- product error shape 정의
- DB row 또는 domain model을 response로 직접 반환

허용:

- health response
- readiness response
- version response

위 응답들은 product data contract가 아니라 runtime 운영 응답이다. 반복되거나 정책이 붙으면 base package로 옮긴다.

## 외부 라이브러리 의존 규칙

외부 라이브러리를 쓴다고 항상 adapter를 만들지는 않는다. 다만 apps가 직접 의존해도 되는 경우는 좁게 본다.

apps가 직접 의존해도 되는 경우:

```text
이 라이브러리를 직접 써도 apps가 여전히 빈 runtime shell인가?
```

예:

```text
apps/api -> hono/fastify/nestjs
apps/web -> react/react-dom/vite
```

apps가 직접 의존하면 안 되는 경우:

- 운영 정책이 붙는 dependency
- 외부 provider 계약을 들고 오는 dependency
- persistence 구조를 들고 오는 dependency
- 제품 규칙이나 workflow/domain 언어를 오염시키는 dependency

예:

| 외부 의존성 | apps 직접 사용 여부 | 이유 |
|---|---:|---|
| `hono` / `fastify` | 가능 | runtime shell 구성 |
| `react` / `react-dom` / `vite` | 가능 | web runtime shell 구성 |
| `pino` | 원칙적으로 package 경유 | requestId, traceId, redaction 정책 |
| `fetch` / `undici` / `axios` | 원칙적으로 package 경유 | timeout, retry, trace, error normalization 정책 |
| `prisma` / `drizzle` | 금지 | persistence 경계 |
| `stripe` / `openai` / S3 SDK | 금지 | 외부 provider 계약 |
| Redis / Kafka / SQS | 금지 | 운영 정책, delivery semantics |

## 외부 라이브러리 판단 트리

```text
Hono/fastify/React처럼 runtime shell을 세우는 데 필요한가?
  -> apps에서 직접 사용 가능

pino/fetch처럼 운영 정책이 붙는가?
  -> base-* package public API 사용

Stripe/OpenAI/S3/Kafka/SendGrid처럼 외부 provider 계약인가?
  -> platform/product adapter public API 사용

Prisma/Drizzle처럼 저장 구조인가?
  -> apps에서 사용 금지

Zod처럼 product data contract schema 도구인가?
  -> apps에서 product DTO/schema 정의 금지
```

## 새 코드 위치 결정

```text
서버 실행, route mount, shutdown인가?
  -> 현재 apps module

React root 렌더링, route 연결인가?
  -> 현재 apps module

프론트/백/socket/client가 공유하는 data contract인가?
  -> apps가 만들지 않는다. package 쪽으로 보낸다.

HTTP request를 workflow로 연결하는 product API adapter인가?
  -> apps가 만들지 않는다. package public API를 mount한다.

유스케이스 실행 흐름인가?
  -> apps가 만들지 않는다.

제품 command 또는 use case input인가?
  -> apps가 만들지 않는다. package workflow 또는 adapter 경계로 보낸다.

도메인 상태/규칙인가?
  -> apps가 만들지 않는다.

DB/ORM 접근인가?
  -> apps가 만들지 않는다.

외부 provider 호출인가?
  -> apps가 직접 호출하지 않는다.
```

## Review Checklist

apps 변경을 볼 때 다음을 확인한다.

- apps module이 실행, mount, wiring만 하는가?
- product DTO가 apps에 추가되지 않았는가?
- product data contract가 apps에 추가되지 않았는가?
- DB query나 provider SDK 호출이 apps에 들어오지 않았는가?
- product별 에러 의미 판단이 apps에 들어오지 않았는가?
- package 내부 파일을 직접 import하지 않았는가?
- 다른 app에서 현재 apps module을 import하지 않는가?
- 외부 라이브러리를 직접 사용할 때 runtime shell 용도인지 설명 가능한가?

## 구현 완료 시 보고 형식

apps 변경을 보고할 때 다음을 명시한다.

```text
변경한 apps:
사용한 package public API:
추가/변경한 runtime endpoint:
외부 dependency 직접 사용 여부:
의도적으로 만들지 않은 adapter와 이유:
apps 경계 규칙 위반 가능성:
```


