# Apps Worker Rules

이 문서는 현재 apps module 구현 worker가 반드시 따르는 최소 규칙이다.

참조:

- 용어: [docs/terminology.md](docs/terminology.md)
- 상세 설명과 예시: [docs/architecture-notes.md](docs/architecture-notes.md)

## 역할

apps module은 deployable runtime shell, composition root, entrypoint, terminal node다.

apps module은 제품 기능을 직접 구현하지 않는다. package public API를 가져와 실행 환경에 연결한다.

## MUST

- 프로세스 부팅, runtime 실행, route/socket/worker mount, env 읽기, logger 생성, middleware 연결, health/readiness/version endpoint, graceful shutdown만 둔다.
- 제품 기능은 package public API와 public exports만 import해서 연결한다.
- runtime framework는 shell 구성에 필요할 때만 직접 사용한다.
- health/readiness/version 같은 runtime 운영 응답만 apps 안에 둘 수 있다.
- 외부 dependency를 직접 import할 때는 apps가 여전히 빈 runtime shell인지 먼저 판단한다.

## MUST NOT

- product request/response DTO를 정의하지 않는다.
- product data contract, socket event payload, product error shape, schema를 정의하지 않는다.
- 도메인 불변식, 비즈니스 정책, 상태 전이, 구현하지 않는다.
- DB query, repository 구현, ORM model 접근을 하지 않는다.
- Stripe/OpenAI/S3/Redis/Kafka/Prisma 같은 provider SDK를 직접 호출하지 않는다.
- package 내부 파일을 직접 import하지 않는다.
- product별 에러 의미나 권한 정책 세부를 apps에서 판단하지 않는다.
- 다른 app에서 현재 apps module을 import하게 만들지 않는다.

## 판단 기준

새 코드가 실행, mount, wiring이면 apps에 둘 수 있다.

새 코드가 product data contract, workflow, domain rule, persistence, provider integration이면 apps에 두지 않는다. package public API로 제공받아 연결한다.

## 완료 보고

apps 변경을 보고할 때 다음을 명시한다.

```text
변경한 apps:
사용한 package public API:
추가/변경한 runtime endpoint:
외부 dependency 직접 사용 여부:
의도적으로 만들지 않은 adapter와 이유:
apps 경계 규칙 위반 가능성:
```
