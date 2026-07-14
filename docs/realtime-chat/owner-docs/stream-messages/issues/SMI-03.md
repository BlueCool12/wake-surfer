# SMI-03 PostgreSQL 통합 테스트 실행 기반 구축

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- 없음

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [09-performance-and-payload.md](../design/09-performance-and-payload.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-03. PostgreSQL 통합 테스트 실행 기반 구축

**목표**

실제 PostgreSQL 18에서 schema, transaction, ordering, concurrency를 반복 검증할 공통 실행 경로를 만든다.

**확정 방식**

- 테스트 runner는 `TEST_DATABASE_URL`을 받는다.
- 각 worker/suite는 충돌하지 않는 임시 schema를 만들고 공통 DB bootstrap을 적용한 뒤 삭제한다.
- 로컬은 현재 Docker Compose의 PostgreSQL 18을 사용한다.
- 자동화 환경도 동일한 root command와 PostgreSQL major version을 사용한다.

**완료 조건**

- root에 `pnpm test:integration:realtime-chat` command가 있다.
- 실패한 테스트 뒤에도 임시 schema를 정리한다.
- 병렬 실행 시 schema가 충돌하지 않는다.
- 현재 gateway ticket과 message table bootstrap smoke test가 통과한다.
- migration 실패가 테스트 성공으로 위장되지 않는다.
- 사용법과 필수 env를 개발 문서에 기록한다.

권장 브랜치 slug: `realtime-chat-pg-test-harness`

---
