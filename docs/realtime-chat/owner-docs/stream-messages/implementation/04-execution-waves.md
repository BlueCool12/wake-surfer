# Stream Messages 구현 계획: 병렬 실행 계획

> [구현 index](./README.md) | [설계 index](../design/README.md)

## 8. 병렬 실행 계획

### Wave 0 — 외부 의존성과 독립 기반 착수

- `DEP-CH-01` channel 기준 상태
- `DEP-AUTH-01` actor 인증 session/edge
- `SMI-01` 공통 message 계약
- `SMI-03` PostgreSQL 테스트 기반
- `SMI-20` Gateway service credential
- `SMI-21` Gateway connected event

### Wave 1 — 계약·migration·순수 client 기반

- `SMI-02` Query contracts
- `SMI-04` append application 불변조건
- `SMI-13` Web merge model
- `SMI-23` versioned migration runner

### Wave 2 — DB upgrade와 공통 runtime 경계

- `SMI-06` API 공통 경계
- `SMI-22` Web realtime session
- `SMI-24` DB byte constraint

`SMI-22`는 `DEP-AUTH-01`, `SMI-21`이 준비된 경우 병렬 진행한다.

### Wave 3 — Provider 기반

- `SMI-07` latest provider

### Wave 4 — 독립 pagination·권한 adapter·recovery model

- `SMI-05` ChannelReadAuthorizer adapter
- `SMI-08` older provider
- `SMI-09` after provider
- `SMI-14` Web cursor/recovery

### Wave 5 — Runtime adapter

- `SMI-10` public HTTP
- `SMI-11` internal sync API

### Wave 6 — Gateway와 Web transport

- `SMI-12` Gateway relay
- `SMI-15` Web transport

`SMI-15`는 `SMI-10`, `SMI-12`, `SMI-14`, `SMI-22`가 모두 준비된 뒤 완료할 수 있다.

### Wave 7 — 소비자 연결과 출시 검증

- `SMI-16` Chat UI
- `SMI-18` process E2E
- `SMI-25` distributed rate limit

`SMI-17` 계약 적합성은 `SMI-25`의 실제 rate-limit producer까지 포함해 이 wave의 마지막에 실행한다.

### Wave 8 — 운영 마감

- `SMI-19` 관측성·운영 문서
