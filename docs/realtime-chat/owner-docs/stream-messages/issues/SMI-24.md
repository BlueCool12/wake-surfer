# SMI-24 Message 8KiB DB constraint audit·migration

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [SMI-01](./SMI-01.md)
- [SMI-23](./SMI-23.md)

### 필요한 공개 계약

- 직접 소비하는 Stream Messages 공개 계약 없음

### 관련 설계

- [09-performance-and-payload.md](../design/09-performance-and-payload.md)

- [Domain Owner 결정](../design/10-domain-owner-decisions.md)
- [Acceptance criteria](../design/11-acceptance-and-non-goals.md)### SMI-24. Message 8KiB DB constraint audit·migration

**목표**

기존 DB를 audit하고 `messages.content_text`에 application과 같은 UTF-8 8KiB invariant를 적용한다.

**완료 조건**

- migration 전에 `octet_length(content_text) > 8192` row를 조회한다.
- 위반 row가 있으면 content 없이 message ID, stream ID, sequence, byte 수만 보고하고 migration을 중단한다.
- 위반 row가 없으면 named CHECK `octet_length(content_text) <= 8192`를 추가하고 validate한다.
- fresh DB에도 같은 constraint가 처음부터 존재한다.
- 반복 실행해도 constraint를 중복 생성하지 않는다.
- 8,192/8,193 byte direct SQL insert와 existing violating DB 통합 테스트가 있다.
- 기존 위반 데이터를 자동 절단·삭제·수정하지 않는다.

권장 브랜치 slug: `message-content-byte-constraint`

---
