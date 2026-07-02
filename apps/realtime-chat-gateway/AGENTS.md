# Realtime Chat Gateway Worker Rules

이 문서는 `apps/realtime-chat-gateway` 구현 worker가 반드시 따르는 최소 규칙이다.

## 역할

gateway app은 WebSocket connection을 유지하는 deployable runtime shell이다.

gateway app은 socket accept, handshake wiring, package public API mount, graceful shutdown, health/readiness/version endpoint만 담당한다.

## MUST

- WebSocket runtime 실행, endpoint mount, env 읽기, logger 생성, middleware 연결, graceful shutdown만 둔다.
- 제품 기능은 package public API와 public exports만 import해서 연결한다.
- runtime framework는 shell 구성에 필요할 때만 직접 사용한다.
- local connection/session map은 package가 제공하는 gateway runtime 또는 adapter 뒤에 둔다.
- Redis, Kafka, DB 같은 외부 provider는 직접 붙이지 않는다. 필요하면 package의 port adapter로 연결한다.

## MUST NOT

- product request/response DTO를 정의하지 않는다.
- socket event payload, product error shape, schema를 정의하지 않는다.
- room membership, message validation, authorization policy, persistence, fanout rule을 직접 구현하지 않는다.
- DB query, repository 구현, ORM model 접근을 하지 않는다.
- package 내부 파일을 직접 import하지 않는다.
- main API 서버의 상태를 대신 소유하지 않는다.

## 판단 기준

새 코드가 gateway process 실행, socket endpoint mount, package runtime 연결이면 apps에 둘 수 있다.

새 코드가 chat data contract, workflow, domain rule, inbound 처리, outbound fanout policy, ticket 검증 정책이면 package 또는 platform 경계로 보낸다.
