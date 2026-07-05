# ADR 004. realtime-chat 테스트 전략

## 상태

Accepted

## 날짜

2026-07-04

## 배경

Realtime chat feature는 pure domain policy뿐 아니라 DB 동시성, WebSocket transport, process boundary DTO mapping도 중요합니다.

단위 테스트만으로는 다음 문제를 검증하기 어렵습니다.

- sequence 중복 방지
- gateway ticket atomic consume
- PostgreSQL transaction/lock behavior
- idempotency unique constraint

## 결정

테스트 도구는 다음을 기준으로 합니다.

| 용도 | 결정 | 이유 |
| --- | --- | --- |
| Unit test runner | Vitest | TypeScript 단위 테스트와 package integration test 실행기로 사용합니다. |
| DB integration test | Testcontainers + PostgreSQL | sequence, lock, idempotency, ticket consume은 실제 PostgreSQL에서 검증해야 합니다. |
| Browser E2E | Playwright | frontend app이 생긴 뒤 도입합니다. |

단위 테스트는 Vitest를 사용합니다.

```txt
unit test
  = Vitest

DB integration test
  = Vitest
  + Testcontainers PostgreSQL

browser E2E
  = Playwright
  = frontend app이 생긴 뒤 도입
```

## 필수 테스트 후보

DB integration test에서 반드시 확인할 항목:

- `clientMessageId` 멱등성
- `streamId + sequence` 중복 방지
- gateway ticket atomic consume
- read cursor no-backward update
- `afterSequence` sync

package/unit test에서 확인할 항목:

- message content validation
- DTO-to-command mapping
- API accepted/rejected response mapping
- Gateway socket event validation
- Gateway ACK relay mapping
- outbound event local fan-out

## 보류한 대안

| 항목 | 보류 이유 |
| --- | --- |
| Playwright 즉시 도입 | frontend app이 아직 없으므로 현재는 보류합니다. |
| SQLite 기반 integration test | PostgreSQL 동시성/locking 검증을 대체하지 못합니다. |

## 결과

app package와 DB adapter가 생길 때 Vitest와 Testcontainers를 실제 사용하는 workspace package에 선언합니다. root에는 repo-level test orchestration script만 둡니다.
