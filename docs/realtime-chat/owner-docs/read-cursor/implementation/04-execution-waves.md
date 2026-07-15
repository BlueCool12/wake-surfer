# Read Cursor 구현 계획: 병렬 실행 계획

> [구현 index](./README.md) | [설계 index](../design/README.md) |
> [실제 브랜치·머지 순서](./07-implementation-order-guide.md)

이 문서는 논리적 병렬 가능성만 보여준다. 실제 브랜치 생성과 `dev` 머지 순서는 공용 package 조립 파일의
충돌 가능성까지 반영한 [구현 순서 가이드](./07-implementation-order-guide.md)를 따른다.

## Wave 0 — 공유 선행과 계약

- `DEP-AUTH-01`, `DEP-CH-01`
- `SMI-01`, `SMI-03`, `SMI-20`, `SMI-21`, `SMI-23`
- `RCI-01` Read Cursor contracts

## Wave 1 — 저장 기반과 순수 Web 모델

- `RCI-02` table/migration
- `RCI-09` Web read observation model

## Wave 2 — 독립 usecase provider

- `RCI-03` mark Command
- `RCI-04` read-state Query

## Wave 3 — Production dependency adapter

- `RCI-05` human identity/channel authorization

## Wave 4 — API adapter

- `RCI-06` internal mark API
- `RCI-07` public read-state HTTP API

## Wave 5 — Gateway와 Web transport

- `RCI-08` Gateway mark relay
- `RCI-10` Web transport

`RCI-10`은 `RCI-07`~`RCI-09`, `SMI-15`, `SMI-22` 결과가 준비된 뒤 완료할 수 있다.

## Wave 6 — 화면 연결과 abuse protection

- `RCI-11` Chat lifecycle
- `RCI-12` distributed rate limit

## Wave 7 — 출시 검증

- `RCI-13` contract conformance
- `RCI-14` process E2E

## Wave 8 — 운영 마감

- `RCI-15` observability/public docs
