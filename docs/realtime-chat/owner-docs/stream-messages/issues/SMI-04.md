# SMI-04 Message append application 불변조건 보강

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-01](./SMI-01.md)
- [SMI-03](./SMI-03.md)

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [09-performance-and-payload.md](../design/09-performance-and-payload.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-04. Message append application 불변조건 보강

**목표**

앞으로 application 경계를 통해 저장되는 message가 query의 byte/target 불변조건을 깨지 않게 한다. 기존
DB schema upgrade는 `SMI-23`, `SMI-24`가 소유한다.

**주요 변경**

- message-send request schema와 use case의 UTF-8 8KiB 이중 검증
- append transaction의 existing stream target 일치 검증

**완료 조건**

- 8,192 byte text는 저장되고 8,193 byte text는 `invalid_content`로 거절된다.
- 우회 호출에서도 use case 검증이 동작한다.
- 기존 `stream_id`의 `target_type/target_id`가 command target과 다르면 sequence 증가와 insert가 모두
  일어나지 않는다.
- 같은 target에 대한 경쟁 append에서도 `(stream_id, sequence)`와 target 불변조건이 유지된다.
- 실제 PostgreSQL 통합 테스트가 있다.

**비범위**

- 기존 oversized content 자동 절단·삭제·수정
- message-send 전체 transport 조립

권장 브랜치 slug: `message-append-invariants`

---
