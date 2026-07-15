# RCI-15 Read Cursor 관측성·운영 계약·공개 문서 마감

> [구현 index](../implementation/README.md) | [이슈 카탈로그](../implementation/03-issue-catalog.md)

## Read first

### 직접 선행 이슈

- [RCI-11](./RCI-11.md)
- [RCI-12](./RCI-12.md)
- [RCI-13](./RCI-13.md)
- [RCI-14](./RCI-14.md)

### 관련 설계

- [Domain Owner 결정](../design/08-domain-owner-decisions.md)
- [Acceptance criteria](../design/09-acceptance-and-non-goals.md)
- [출시 관문](../implementation/05-release-gates-and-followups.md)

## 작업 정의

**목표**

운영자가 Read Cursor 실패를 구분할 수 있게 하고, 실제 구현과 검증된 consumer contract만 public 문서로
승격한다.

**주요 변경**

- mark outcome, latency, rejection, retryable failure, data-integrity failure metrics
- request correlation을 가진 구조화 로그
- stream target mismatch와 DB failure 운영 대응
- rate limit dashboard/alert 기준
- package README와 `public-docs/read-cursor/`의 API/invariants/integration 문서
- `docs/realtime-chat/AGENTS.md` consumer route 추가

**완료 조건**

- log/metric label에 unbounded user/channel/message 값이 없다.
- 권한 거절과 provider 장애와 data-integrity failure를 구분할 수 있다.
- public docs가 사람 사용자, monotonic cursor, empty channel, requester-only, `hasUnread` 의미를 설명한다.
- owner-only 설계·이슈·notes가 consumer route에 노출되지 않는다.
- 출시 관문 전체 체크리스트가 evidence 링크와 함께 닫힌다.
- README와 실제 package exports/route가 일치한다.

**비범위**

- 후속 inbox/receipt/event 설계
- GitHub 이슈 생성 자체

권장 브랜치 slug: `read-cursor-operations`
