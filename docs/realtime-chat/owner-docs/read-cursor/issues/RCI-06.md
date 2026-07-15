# RCI-06 Package-owned internal mark API 구현

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-03](./RCI-03.md)
- [RCI-05](./RCI-05.md)
- [SMI-06 API 공통 경계](../../stream-messages/issues/SMI-06.md)
- [SMI-20 Gateway service credential](../../stream-messages/issues/SMI-20.md)

### 관련 설계

- [입출력과 transport](../design/06-contracts-and-transport.md)
- [Identity와 권한](../design/04-identity-and-authorization.md)

## 작업 정의

**목표**

인증된 Gateway만 호출할 수 있는 package-owned internal mark HTTP route와 API mount entrypoint를 구현한다.

**주요 변경**

- contracts schema 기반 strict request parsing
- service credential 검증 뒤 Gateway actor assertion 수용
- trusted context→Command mapping과 결과/error mapping
- abort/timeout/request correlation
- API shell의 runtime resource 조립과 package mount

**완료 조건**

- 미인증 Gateway와 client 직접 호출을 거절한다.
- body의 actor/user/gateway 식별자를 신뢰하지 않는다.
- `commandId`를 accepted/rejected에 보존한다.
- `stream_unavailable`, `invalid_cursor`, retryable failure 의미가 섞이지 않는다.
- app shell에 Handler, query, 도메인 분기가 없다.
- route registration과 unmount/cleanup test가 있다.

**비범위**

- public browser mark HTTP API
- Gateway WebSocket relay
- read-state Query route

권장 브랜치 slug: `read-cursor-internal-api`
