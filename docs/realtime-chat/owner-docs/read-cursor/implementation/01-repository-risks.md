# Read Cursor 구현 계획: 저장소 선행 위험

> [구현 index](./README.md) | [설계 index](../design/README.md)

## Read Cursor 기반 부재

현재 구현 package, contracts, table, migration, API/Gateway route가 모두 없다. `RCI-01`과 `RCI-02`가
package/table 기반을 만들기 전 provider와 adapter 이슈를 시작하지 않는다.

## 사람 identity와 channel source 부재

현재 Gateway `actorId`는 다형 principal이고 production public actor session과 channel 기준 상태가 없다.
Read Cursor는 stable human `userId`와 authorize-before-data가 필수다.

- `DEP-AUTH-01`이 사람 사용자 session/trusted edge를 제공한다.
- `DEP-CH-01`이 channel 존재와 membership 기준 상태를 제공한다.
- `RCI-05`는 두 provider의 공개 결과를 Read Cursor의 좁은 consumer contract로 번역한다.

allow-all authorizer, client-supplied user ID, generic actor ID 직접 저장은 허용하지 않는다.

## Message stream 공개 경계

현재 stream table은 Message Send가 소유한다. Read Cursor가 내부 Kysely helper를 deep import하지 않도록
Stream Messages의 `SMI-01`이 제공할 canonical stream identity와 공개 table/message 계약에 의존한다.
head와 target mismatch는 primary DB에서 읽고 data-integrity failure로 구분한다.

## PostgreSQL migration/test 기반

실제 PostgreSQL 경쟁 조건과 upgrade 경로가 공통화돼 있지 않다. Stream Messages의 `SMI-03` PostgreSQL
시험 기반과 `SMI-23` versioned migration runner를 직접 선행 조건으로 사용한다. 이를 복제한 Read Cursor
전용 runner를 만들지 않는다.

## API/Gateway/Web 기반 부족

- API/Gateway app에 추적되는 실행 코드가 없다.
- API 공통 오류/CORS/timeout 경계와 Gateway service credential이 없다.
- Gateway connected readiness와 Web authenticated realtime session이 없다.
- Web은 sequence-aware merge와 실제 Stream Messages transport가 없다.

따라서 `SMI-06`, `SMI-13`, `SMI-15`, `SMI-16`, `SMI-20`~`SMI-22`를 필요한 Read Cursor 이슈의 직접
선행으로 연결한다.

## 과도한 mark 요청

client debounce는 correctness가 아니라 효율 최적화다. 악의적 client를 막으려면 process 공통 분산
limiter가 필요하다. `SMI-25`의 limiter 기반을 재사용하되 Read Cursor key와 정책 연결은 `RCI-12`가
독립적으로 검증한다.
